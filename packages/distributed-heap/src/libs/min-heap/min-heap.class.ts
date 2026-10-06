import type { HeapComparator } from '@heap-core/types';
import type { IMinHeap } from './min-heap.types';

export class MinHeap<T> implements IMinHeap<T> {
  private readonly heap: T[] = [];

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
   * Inserts a new element into the heap while preserving the min-heap property.
   *
   * @param element - Element to insert.
   */
  public insert(element: T): void {
    this.heap.push(element);
    this.siftUp(this.heap.length - 1);
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
   * so objects must be passed by reference. Runs in O(n) because of the linear search.
   *
   * @param element - Element to remove.
   * @returns The removed element, or `undefined` if the element was not found.
   */
  public delete(element: T): T | undefined {
    const index = this.heap.indexOf(element);

    if (index === -1) {
      return undefined;
    }

    return this.removeAt(index);
  }

  private removeAt(index: number): T | undefined {
    const lastIndex = this.heap.length - 1;

    if (index > lastIndex) {
      return undefined;
    }

    this.swap(index, lastIndex);

    const removedElement = this.heap.pop();

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
