export interface IMinHeap<T> {
  readonly size: number;
  readonly peek: T | undefined;
  toArray(): T[];
  insert(element: T): void;
  extractMin(): T | undefined;
  delete(element: T): T | undefined;
}
