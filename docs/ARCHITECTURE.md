# Архитектура системы асинхронной обработки файлов

Программное средство выполняет асинхронную обработку файлов (конвертация, сжатие, изменение размера и другие преобразования) на распределённых worker-процессах. Пользователь загружает файл через веб-интерфейс, следит за статусом задачи и скачивает результат.

Требования, которые определяют архитектуру:

- одновременная обработка нескольких задач;
- распределение нагрузки между обработчиками;
- контроль состояния выполняемых операций;
- повторный запуск задач при ошибках;
- хранение исходных и обработанных файлов, информации о задачах и результатах.

Стек: React + TypeScript, Node.js + NestJS, RabbitMQ, PostgreSQL, S3-совместимое объектное хранилище (MinIO), Docker.

## 1. Общая схема

```
                        ┌────────────────────┐
                        │  Browser (React)   │
                        └───┬────────────┬───┘
              REST + WebSocket│          │ PUT/GET по presigned URL
                            ▼            ▼
                   ┌──────────────┐   ┌──────────────┐
                   │ API (NestJS) │   │ MinIO (S3)   │◄───────────────┐
                   └──┬────────┬──┘   └──────────────┘                │
            INSERT task│        │ publish task.created                │ скачать вход /
                       ▼        ▼                                     │ загрузить результат
              ┌────────────┐  ┌───────────────────────────────┐   ┌───┴────────┐
              │ PostgreSQL │  │           RabbitMQ            │──►│ Worker × N │
              └─────▲──────┘  │  tasks.* (dispatch)  events.* │◄──│ (stateless)│
                    │         └───────┬──────────────▲────────┘   └────────────┘
       переходы     │                 │ события      │ dispatch
       статусов     │                 ▼              │
                    │         ┌──────────────────────┴──┐
                    └─────────┤       Scheduler         │
                              │  FairQueue  (MinHeap)   │
                              │  TimerQueue (MinHeap)   │
                              └─────────────────────────┘
```

### Ответственность компонентов

| Компонент | Отвечает за | Не делает |
|---|---|---|
| **Web** | загрузку файлов, выбор операции, отслеживание статуса в реальном времени, скачивание | не работает с брокером, к хранилищу обращается только по presigned-ссылкам |
| **API** | аутентификацию, выдачу presigned URL, создание задач, чтение задач, WebSocket-шлюз | не решает, когда и где запускать задачу |
| **Scheduler** | порядок запуска (fair share), ограничение числа задач в обработке, ретраи, таймауты, учёт воркеров, восстановление после сбоя. **Только он меняет статус задачи после её создания** | не обрабатывает файлы |
| **Worker** | скачать вход, выполнить операцию, загрузить результат, отправить события | не пишет в БД и не хранит состояние |
| **PostgreSQL** | источник истины: задачи, попытки, файлы | |
| **RabbitMQ** | доставку задачи свободному воркеру, подтверждения (ack), события | не решает вопросы порядка и справедливости |
| **MinIO** | хранение исходных и обработанных файлов | |

**Ключевой принцип: у статуса задачи один писатель, Scheduler.** Это снимает класс гонок вроде такой: воркер прислал «готово», а планировщик в это же время признал задачу зависшей и перезапустил её. Все решения принимаются в одном месте, остальные компоненты только сообщают о фактах.

### Соответствие требованиям

| Требование | Чем закрывается |
|---|---|
| Передача задачи свободному обработчику, распределение нагрузки | RabbitMQ: competing consumers + `prefetch`, Scheduler ограничивает число задач в обработке |
| Справедливый порядок обработки между пользователями | Scheduler: FairQueue на MinHeap |
| Повторный запуск при ошибках | Scheduler: TimerQueue на MinHeap, экспоненциальная задержка |
| Контроль состояния операций | статусы и попытки в PostgreSQL, таймауты в TimerQueue, события в реальном времени по WebSocket |
| Хранение файлов | MinIO |
| Хранение задач и результатов | PostgreSQL |

## 2. Структура монорепозитория

```
apps/
  web/            React (Next.js)
  api/            NestJS: HTTP + WebSocket gateway
  scheduler/      NestJS standalone (из HTTP только /health)
  worker/         NestJS standalone, внутри processors/
packages/
  contracts/      статусы, DTO, сообщения брокера, zod-схемы параметров операций
  scheduling/     MinHeap, FairQueue, TimerQueue (сейчас distributed-heap), без зависимостей
  db/             схема (Prisma или TypeORM), миграции
  storage/        обёртка над S3 SDK: presign, upload, download
  messaging/      топология RabbitMQ, типизированные publish/consume
  ui/  typescript-config/  biome-config/
docker/
  docker-compose.yml
```

`contracts` нужен, чтобы API, Scheduler и Worker не расходились в формате сообщений: изменил тип, и `check-types` упадёт во всех местах, где этот тип используется. `scheduling` остаётся чистой библиотекой без NestJS, поэтому её легко тестировать и удобно описывать как отдельный алгоритмический модуль.

## 3. Жизненный цикл задачи

```
           dispatch           task.started
 QUEUED ─────────────► DISPATCHED ─────────► RUNNING ─────────► SUCCEEDED
   ▲                       │ timeout            │
   │                       ▼                    │ error / timeout
   └──── RETRY_SCHEDULED ◄──────────────────────┤
         (backoff в TimerQueue)                 │ попытки исчерпаны
                                                │ или ошибка неустранима
                                                ▼
                                             FAILED

 CANCELLED: из любого незавершённого состояния
```

```ts
// packages/contracts/src/task-status.ts
export const TaskStatus = {
  Queued: 'queued',
  Dispatched: 'dispatched',
  Running: 'running',
  RetryScheduled: 'retry_scheduled',
  Succeeded: 'succeeded',
  Failed: 'failed',
  Cancelled: 'cancelled',
} as const;
```

Переходы защищены условным UPDATE с номером попытки (fencing):

```sql
UPDATE tasks SET status = 'succeeded', output_file_id = $3, finished_at = now()
WHERE id = $1 AND attempt = $2 AND status = 'running';
-- 0 строк = событие от устаревшей попытки, игнорируем
```

Без такой проверки возможна ошибка: воркер завис, планировщик перезапустил задачу (attempt 2), потом первый воркер «ожил» и прислал результат attempt 1. С проверкой этот результат просто отбрасывается.

## 4. Основные сценарии

### 4.1. Загрузка и создание задачи

```
Web ──POST /uploads {name, size, mime}──► API ── INSERT files ──► { fileId, uploadUrl }
Web ──PUT uploadUrl (с прогрессом)──────► MinIO
Web ──POST /tasks {fileId, operation, params}──► API
        API: валидация params по zod-схеме операции
        API: INSERT tasks (status = queued)
        API: publish task.created
Web ◄──WS task.updated──
```

Файл грузится в MinIO напрямую, минуя API, поэтому NestJS не пропускает через себя гигабайты и не упирается в память.

### 4.2. Планирование и отправка

**Scheduler не перекладывает все задачи в RabbitMQ сразу.** Иначе брокер обработал бы их по FIFO, и fair share потерял бы смысл: 500 задач одного пользователя оказались бы в очереди раньше единственной задачи другого. Поэтому планировщик держит основную очередь у себя, а в брокер кладёт ровно столько задач, сколько воркеры способны взять прямо сейчас (backpressure).

```ts
// apps/scheduler/src/scheduler.service.ts
private pump(): void {
  while (this.inFlight < this.workers.capacity) {
    const task = this.fairQueue.next();
    if (!task) return;

    this.inFlight++; // резервируем синхронно, до первого await
    this.dispatch(task).catch((error) => this.onDispatchError(task, error));
  }
}

private async dispatch(task: Task): Promise<void> {
  const attempt = await this.tasks.markDispatched(task.id); // attempt + 1
  await this.broker.publish(`tasks.${task.kind}`, { taskId: task.id, attempt, ... });
  this.timers.schedule({ type: 'dispatch-timeout', taskId: task.id, attempt, runAt: Date.now() + DISPATCH_TIMEOUT });
}
```

`capacity` складывается из concurrency всех живых воркеров по их heartbeat. Если воркеры разделены по типам (image, video), у каждого типа своя `FairQueue` и своя `capacity`.

### 4.3. Выполнение

```
Worker: consume tasks.image (prefetch = concurrency)
  → publish task.started {taskId, attempt, workerId}
  → скачать input из MinIO во временный файл
  → processor.process(...)            → периодически task.progress
  → загрузить results/{taskId}/{attempt}/{name}
  → publish task.succeeded {taskId, attempt, output, metadata}
  → ack
Scheduler: условный UPDATE → inFlight-- → pump()
API:       событие → WS в комнату пользователя
```

Ack отправляется только после загрузки результата (семантика at-least-once). Если воркер упадёт посреди обработки, RabbitMQ сам вернёт сообщение в очередь.

### 4.4. Ошибка и повторный запуск

```ts
private onTaskFailed(event: TaskFailedEvent): void {
  if (!event.retryable || event.attempt >= task.maxAttempts) {
    return this.markFailed(event); // например, «неподдерживаемый формат» повторять бессмысленно
  }
  const delay = BASE_DELAY * 2 ** event.attempt; // 2s, 4s, 8s...
  this.timers.schedule({ type: 'retry', taskId: event.taskId, runAt: Date.now() + delay });
}
```

Ошибки делятся на **устранимые** (таймаут, сбой хранилища, нехватка памяти) и **неустранимые** (битый файл, неверные параметры). Неустранимые сразу переводят задачу в FAILED.

### 4.5. Восстановление планировщика после падения

```ts
async onApplicationBootstrap(): Promise<void> {
  for (const task of await this.tasks.findActive()) {
    if (task.status === 'queued' || task.status === 'retry_scheduled') this.fairQueue.enqueue(task);
    else this.timers.schedule(timeoutFor(task)); // dispatched/running: ждём событие или таймаут
  }
  setInterval(() => this.reconcile(), RECONCILE_INTERVAL); // подбирает потерянные task.created
}
```

Очередь `scheduler.events` в RabbitMQ durable, поэтому события, пришедшие за время простоя, никуда не пропадают. Периодическая сверка с БД закрывает случай, когда API записал задачу, но не успел отправить событие. Благодаря этому можно обойтись без паттерна transactional outbox.

## 5. Внутреннее устройство Scheduler

```
Scheduler
├── FairQueue          MinHeap<Tenant> по served (потреблённые ресурсы)
│                      у каждого пользователя своя FIFO его задач
├── TimerQueue         MinHeap<Timer> по runAt, один setTimeout на вершину
│                      типы: retry | dispatch-timeout | run-timeout | worker-expiry
├── WorkerRegistry     Map<workerId, {concurrency, lastSeen}> → capacity
└── inFlight           счётчик задач в состояниях dispatched + running
```

```ts
type Timer =
  | { type: 'retry'; taskId: string; runAt: number }
  | { type: 'dispatch-timeout' | 'run-timeout'; taskId: string; attempt: number; runAt: number }
  | { type: 'worker-expiry'; workerId: string; runAt: number };
```

### FairQueue

Обычная FIFO-очередь даёт такую проблему: пользователь A загрузил 500 фотографий на сжатие, пользователь B загрузил один файл и ждёт, пока обработаются все 500. Брокеры это из коробки не решают. FairQueue хранит кучу пользователей по объёму уже потреблённых ресурсов и на каждом шаге выдаёт задачу того, кто получил меньше всех.

```ts
type Tenant = { userId: string; served: number; pending: Task[] };

class FairQueue {
  private readonly tenants = new MinHeap<Tenant>((a, b) => a.served < b.served);

  public next(): Task | undefined {
    const tenant = this.tenants.peek;
    const task = tenant?.pending.shift();
    if (!tenant || !task) return undefined;

    tenant.served += estimateCost(task); // размер файла × коэффициент операции
    tenant.pending.length > 0 ? this.tenants.update(tenant) : this.tenants.delete(tenant);
    return task;
  }
}
```

- Стоимость задачи считается по размеру файла и типу операции: сжатие видео обходится примерно в 10 раз дороже ресайза картинки.
- Новый пользователь стартует со значения `served` вершины кучи, а не с нуля. Иначе он займёт систему целиком, пока не догонит остальных.

### TimerQueue

Куча таймеров по `runAt`. Вместо таймера на каждую задачу всегда работает ровно один `setTimeout`, на ближайший таймер.

```ts
const armTimer = (): void => {
  const next = timers.peek;
  if (next === undefined) return;
  setTimeout(fireDue, Math.max(0, next.runAt - Date.now()));
};

const fireDue = (): void => {
  while (timers.peek !== undefined && timers.peek.runAt <= Date.now()) {
    handle(timers.extractMin()!);
  }
  armTimer();
};
```

### Требования к MinHeap

| Операция | Сложность | Где используется |
|---|---|---|
| `insert` | O(log n) | постановка задачи, таймера |
| `extractMin` | O(log n) | выбор следующего пользователя / срабатывание таймера |
| `update` | O(log n) | изменение `served` пользователя |
| `delete` | O(log n) | отмена таймера, уход пользователя из очереди |
| `peek`, `has` | O(1) | проверка вершины |

Нужные доработки текущей реализации:

1. **Индексация по ключу (`getKey`).** Пользователи и задачи приходят из БД и брокера как новые объекты, поэтому поиск по ссылке не сработает.
2. **Стабильность через `seq`.** При равном приоритете элементы должны выходить в порядке добавления.
3. **Переименование пакета** `distributed-heap` → `scheduling`: сама куча не распределённая.

### Асинхронность

JS однопоточный, поэтому каждая операция кучи атомарна, а последовательность операций с `await` между ними уже нет. Ресурс резервируется синхронно, до первого `await`, и освобождается при ошибке (см. `pump` в 4.2).

## 6. Модель данных

```
users          id, email, password_hash, created_at

files          id, owner_id, bucket, object_key, original_name, mime, size,
               checksum, role (input | output), created_at

tasks          id, owner_id, input_file_id, output_file_id?, operation, params jsonb,
               kind (image | video | document), status, attempt, max_attempts,
               cost, last_error, created_at, started_at, finished_at

task_attempts  task_id, attempt, worker_id, status, error,
               started_at, finished_at, duration_ms
```

Индексы:

- частичный `tasks(status) WHERE status NOT IN ('succeeded', 'failed', 'cancelled')` для восстановления и сверки;
- `tasks(owner_id, created_at DESC)` для списка задач в UI.

Таблица `task_attempts` даёт пользователю историю попыток и служит источником данных для экспериментов.

## 7. Топология RabbitMQ

```
exchange "tasks" (direct)
  image    → queue tasks.image     ← воркеры с sharp
  video    → queue tasks.video     ← воркеры с ffmpeg
  document → queue tasks.document  ← воркеры с LibreOffice
  dead-letter → tasks.dlq          (сообщения, которые не удалось разобрать)

exchange "events" (topic)
  task.*, worker.heartbeat → queue scheduler.events          (durable)
  task.*                   → queue api.events.<instanceId>   (exclusive, для WS)
```

```ts
// packages/contracts/src/messages.ts
export interface DispatchTaskMessage {
  taskId: string;
  attempt: number;
  operation: Operation;
  params: OperationParams;
  input: ObjectRef; // { bucket, key }
  deadline: number;
}

export type TaskEvent =
  | { type: 'task.started'; taskId: string; attempt: number; workerId: string }
  | { type: 'task.progress'; taskId: string; attempt: number; percent: number }
  | { type: 'task.succeeded'; taskId: string; attempt: number; output: ObjectRef; metadata: FileMetadata }
  | { type: 'task.failed'; taskId: string; attempt: number; error: string; retryable: boolean };
```

У RabbitMQ по умолчанию `consumer_timeout` составляет 30 минут. Для долгой обработки видео его нужно увеличить, иначе брокер разорвёт соединение с воркером.

## 8. Worker

```ts
// apps/worker/src/processors/processor.types.ts
export interface FileProcessor<P> {
  readonly operation: Operation;
  process(inputPath: string, params: P, context: ProcessContext): Promise<ProcessResult>;
}

interface ProcessContext {
  workDir: string;
  signal: AbortSignal; // таймаут операции убивает дочерний процесс ffmpeg
  reportProgress(percent: number): void;
}
```

| Тип | Операции | Инструмент |
|---|---|---|
| image | resize, convert (jpg/png/webp/avif), compress | `sharp` |
| video / audio | convert, compress, extract audio, превью | `ffmpeg` (дочерний процесс) |
| document | docx/xlsx → pdf | LibreOffice headless |
| любые | архивация zip / gzip | `archiver`, `zlib` |

- Тяжёлые инструменты запускаются как дочерние процессы или в thread pool (`sharp`), поэтому event loop не блокируется и heartbeat продолжают уходить.
- Временная директория удаляется в `finally`.
- Для каждого типа воркера свой Docker-образ: образ с ffmpeg и LibreOffice весит сотни мегабайт, и тащить его в воркер для картинок незачем.

## 9. API

```
POST /auth/register, /auth/login
GET  /operations              список операций и схемы их параметров (по ним строится форма)
POST /uploads                 → { fileId, uploadUrl }
POST /tasks                   → { taskId }
GET  /tasks?status=&cursor=
GET  /tasks/:id               вместе с попытками и метаданными результата
POST /tasks/:id/cancel        → событие task.cancel-requested для Scheduler
POST /tasks/:id/retry         ручной перезапуск задачи в статусе FAILED
GET  /tasks/:id/download      → 302 на presigned GET
WS   /events                  task.updated, комната по userId (только свои задачи)
GET  /admin/stats             воркеры, длина очередей, статистика fair share
```

## 10. Frontend

- **Загрузка:** drag & drop, выбор операции, форма параметров строится по схеме из `/operations`, прогресс загрузки в MinIO.
- **Список задач:** статус и прогресс в реальном времени.
- **Карточка задачи:** история попыток, ошибки, метаданные результата, кнопки «Скачать», «Повторить», «Отменить».
- **Дашборд:** живые воркеры, их нагрузка, длины очередей, время ожидания по пользователям.

Данные: TanStack Query для REST, WebSocket-события инвалидируют или обновляют кеш. После переподключения WebSocket делается refetch, чтобы не потерять события, пришедшие во время разрыва.

## 11. Docker Compose

```yaml
services:
  postgres:   { image: postgres:17, volumes: [pgdata:/var/lib/postgresql/data] }
  rabbitmq:   { image: rabbitmq:4-management, ports: ["15672:15672"] }
  minio:      { image: minio/minio, command: server /data --console-address ":9001" }
  minio-init: { image: minio/mc, depends_on: [minio] } # создаёт бакеты и lifecycle-правила
  api:        { build: { dockerfile: apps/api/Dockerfile }, depends_on: [postgres, rabbitmq, minio] }
  scheduler:  { build: { dockerfile: apps/scheduler/Dockerfile }, restart: always } # строго 1 экземпляр
  worker-image:
    build: { dockerfile: apps/worker/Dockerfile.image }
    environment: { WORKER_KIND: image, CONCURRENCY: 4 }
    deploy: { replicas: 3 }
  worker-video:
    build: { dockerfile: apps/worker/Dockerfile.video }
    environment: { WORKER_KIND: video, CONCURRENCY: 1 }
  web:        { build: { dockerfile: apps/web/Dockerfile }, ports: ["3000:3000"] }
```

Масштабирование воркеров: `docker compose up --scale worker-image=5`. На дашборде видно, как растёт `capacity` и падает время ожидания.

## 12. Поведение при отказах

| Отказ | Что происходит |
|---|---|
| Воркер упал | RabbitMQ возвращает неподтверждённое сообщение, задачу берёт другой воркер |
| Воркер завис | срабатывает `run-timeout` в TimerQueue и запускается ретрай; поздний результат отбрасывается по `attempt` |
| Воркер пропал | `worker-expiry`: уменьшается `capacity`, его задачи уходят в ретрай |
| Scheduler упал | `restart: always`, очереди восстанавливаются из БД, события ждут в durable-очереди |
| API упал | обработка продолжается, клиент переподключает WebSocket и делает refetch |
| Потерялось `task.created` | задачу подберёт периодическая сверка |
| Битый файл | неустранимая ошибка, сразу FAILED без ретраев |
| Некорректное сообщение | dead-letter queue |

### Ограничения

Scheduler работает в одном экземпляре. Для отказоустойчивости в продакшене понадобился бы выбор лидера, например через `pg_advisory_lock`, или перенос состояния очередей в Redis. Это направление развития, а не дефект архитектуры: при падении планировщика задачи не теряются, обработка только приостанавливается до его перезапуска.

## 13. Порядок реализации

1. `contracts`, схема БД, docker-compose с инфраструктурой.
2. API: загрузки и создание задач.
3. **MVP без планировщика:** API публикует задачу прямо в `tasks.image`, воркер с одной операцией (resize через sharp). Сквозной сценарий заработает рано, и основной риск будет снят.
4. Scheduler: владение статусами, отправка с ограничением `capacity`, heartbeat воркеров.
5. TimerQueue: ретраи и таймауты.
6. FairQueue плюс эксперимент «FIFO против fair share»: среднее время ожидания «маленького» пользователя рядом с «тяжёлым».
7. Frontend: статусы в реальном времени, карточка задачи.
8. Остальные операции (видео, документы), дашборд, метрики.
