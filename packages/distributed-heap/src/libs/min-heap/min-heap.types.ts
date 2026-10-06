export interface IMinHeap<T> {
  readonly size: number;
  readonly peek: T | undefined;
  toArray(): T[];
  has(element: T): boolean;
  insert(element: T): void;
  extractMin(): T | undefined;
  delete(element: T): T | undefined;
  update(element: T): boolean;
}
