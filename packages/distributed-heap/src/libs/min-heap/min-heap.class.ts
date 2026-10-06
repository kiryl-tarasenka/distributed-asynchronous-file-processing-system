import type { HeapComparator } from '@heap-core/types';
import type { IMinHeap } from './min-heap.types';

/**
 * Binary min-heap with an element-to-index map, so that `delete` and `update` run in O(log n).
 * Elements must be unique (by strict equality / reference).
 */
export class MinHeap<T> implements IMinHeap<T> {
  private readonly heap: T[] = [];
  private readonly indices = new Map<T, number>();

  constructor(private readonly isLess: HeapComparator<T>) {}

  /**
   * Returns the number of elements currently stored in the heap.
   */
  public get size(): number {
    return this.heap.length;
  }

  /**
   * Returns the smallest element in the heap without removing it.
   *
   * @returns The smallest element, or `undefined` if the heap is empty.
   */
  public get peek(): T | undefined {
    return this.heap[0];
  }

  /**
   * Returns a shallow copy of the underlying array in heap order (not sorted).
   */
  public toArray(): T[] {
    return [...this.heap];
  }

  /**
   * Checks whether the element is in the heap.
   */
  public has(element: T): boolean {
    return this.indices.has(element);
  }

  /**
   * Inserts a new element into the heap while preserving the min-heap property.
   *
   * @param element - Element to insert.
   * @throws If the element is already in the heap.
   */
  public insert(element: T): void {
    if (this.indices.has(element)) {
      throw new Error('Element is already in the heap');
    }

    const index = this.heap.length;

    this.heap.push(element);
    this.indices.set(element, index);
    this.siftUp(index);
  }

  /**
   * Removes and returns the smallest element in the heap.
   *
   * @returns The smallest element, or `undefined` if the heap is empty.
   */
  public extractMin(): T | undefined {
    return this.removeAt(0);
  }

  /**
   * Removes the specified element from the heap. Elements are matched by strict equality,
   * so objects must be passed by reference.
   *
   * @param element - Element to remove.
   * @returns The removed element, or `undefined` if the element was not found.
   */
  public delete(element: T): T | undefined {
    const index = this.indices.get(element);

    if (index === undefined) {
      return undefined;
    }

    return this.removeAt(index);
  }

  /**
   * Restores the element's position after its priority was changed in place
   * (e.g. a worker's `load` was mutated while it is in the heap).
   *
   * @param element - Element whose priority has changed.
   * @returns `true` if the element was found, `false` otherwise.
   */
  public update(element: T): boolean {
    const index = this.indices.get(element);

    if (index === undefined) {
      return false;
    }

    this.restoreAt(index);

    return true;
  }

  private removeAt(index: number): T | undefined {
    const lastIndex = this.heap.length - 1;

    if (index > lastIndex) {
      return undefined;
    }

    this.swap(index, lastIndex);

    const removedElement = this.heap.pop();

    if (removedElement !== undefined) {
      this.indices.delete(removedElement);
    }

    if (index < this.heap.length) {
      this.restoreAt(index);
    }

    return removedElement;
  }

  /**
   * Moves the element at the specified index up or down, whichever direction violates the heap property.
   */
  private restoreAt(index: number): void {
    if (index > 0 && this.isLess(this.heap[index], this.heap[this.getParent(index)])) {
      this.siftUp(index);
    } else {
      this.siftDown(index);
    }
  }

  /**
   * Restores the min-heap property by moving an element towards the root.
   *
   * @param index - Index of the element to move up.
   */
  private siftUp(index: number): void {
    let currentIndex = index;

    while (currentIndex > 0) {
      const parentIndex = this.getParent(currentIndex);

      if (!this.isLess(this.heap[currentIndex], this.heap[parentIndex])) {
        break;
      }

      this.swap(currentIndex, parentIndex);
      currentIndex = parentIndex;
    }
  }

  /**
   * Restores the min-heap property by moving an element towards the leaves.
   *
   * @param index - Index of the element to move down.
   */
  private siftDown(index: number): void {
    let currentIndex = index;
    let smallestIndex = this.getSmallestOfParentAndChildren(currentIndex);

    while (smallestIndex !== currentIndex) {
      this.swap(currentIndex, smallestIndex);
      currentIndex = smallestIndex;
      smallestIndex = this.getSmallestOfParentAndChildren(currentIndex);
    }
  }

  private getSmallestOfParentAndChildren(parentIndex: number): number {
    const heapSize = this.heap.length;
    const leftChild = this.getLeftChild(parentIndex);
    const rightChild = this.getRightChild(parentIndex);
    let smallestIndex = parentIndex;

    if (leftChild < heapSize && this.isLess(this.heap[leftChild], this.heap[smallestIndex])) {
      smallestIndex = leftChild;
    }

    if (rightChild < heapSize && this.isLess(this.heap[rightChild], this.heap[smallestIndex])) {
      smallestIndex = rightChild;
    }

    return smallestIndex;
  }

  private swap(i: number, j: number): void {
    [this.heap[i], this.heap[j]] = [this.heap[j], this.heap[i]];
    this.indices.set(this.heap[i], i);
    this.indices.set(this.heap[j], j);
  }

  private getParent(childIndex: number): number {
    return Math.floor((childIndex - 1) / 2);
  }

  private getLeftChild(parentIndex: number): number {
    return parentIndex * 2 + 1;
  }

  private getRightChild(parentIndex: number): number {
    return parentIndex * 2 + 2;
  }
}
