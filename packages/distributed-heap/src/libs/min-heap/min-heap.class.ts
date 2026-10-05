import type { Heapify } from '@heap-core/types';
import type { IMinHeap } from './min-heap.types';

export class MinHeap<T> implements IMinHeap<T> {
  private readonly heap: T[] = [];

  /**
   * Returns the number of elements currently stored in the heap.
   */
  public get size() {
    return this.heap.length;
  }

  /**
   * Restores the min-heap property starting from the specified index.
   *
   * @param array - Array representing the heap.
   * @param index - Index of the element from which heapification starts.
   */
  private readonly heapify: Heapify<T> = (array, index) => {
    const heapSize = array.length;

    let smallestIndex = index;
    const leftChild = this.getLeftChild(smallestIndex);
    const rightChild = this.getRightChild(smallestIndex);

    if (leftChild < heapSize && array[leftChild] < array[smallestIndex]) {
      smallestIndex = leftChild;
    }

    if (rightChild < heapSize && array[rightChild] < array[smallestIndex]) {
      smallestIndex = rightChild;
    }

    if (smallestIndex !== index) {
      [array[index], array[smallestIndex]] = [array[smallestIndex], array[index]];
      this.heapify(array, smallestIndex);
    }
  };

  /**
   * Returns the index of the left child for the specified parent index.
   *
   * @param parentIndex - Index of the parent element.
   * @returns Index of the left child.
   */
  private getLeftChild(parentIndex: number) {
    return parentIndex * 2 + 1;
  }

  /**
   * Returns the index of the right child for the specified parent index.
   *
   * @param parentIndex - Index of the parent element.
   * @returns Index of the right child.
   */
  private getRightChild(parentIndex: number) {
    return parentIndex * 2 + 2;
  }
}
