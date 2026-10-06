import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { HeapComparator } from '@heap-core/types';
import { MinHeap } from './min-heap.class';

const numberComparator: HeapComparator<number> = (a, b) => a < b;

const createNumberHeap = (values: number[] = []): MinHeap<number> => {
  const heap = new MinHeap<number>(numberComparator);

  for (const value of values) {
    heap.insert(value);
  }

  return heap;
};

type Worker = {
  id: string;
  load: number;
};

const workerComparator: HeapComparator<Worker> = (a, b) => a.load < b.load;

const createWorkerHeap = (workers: Worker[]): MinHeap<Worker> => {
  const heap = new MinHeap<Worker>(workerComparator);

  for (const worker of workers) {
    heap.insert(worker);
  }

  return heap;
};

const drain = <T>(heap: MinHeap<T>): T[] => {
  const result: T[] = [];

  for (let element = heap.extractMin(); element !== undefined; element = heap.extractMin()) {
    result.push(element);
  }

  return result;
};

const assertMinHeap = <T>(values: T[], isLess: HeapComparator<T>): void => {
  for (let i = 0; i < values.length; i++) {
    for (const child of [i * 2 + 1, i * 2 + 2]) {
      if (child < values.length && isLess(values[child], values[i])) {
        assert.fail(`Min-heap violation: parent at index ${i} is greater than child at index ${child}`);
      }
    }
  }
};

/**
 * Deterministic PRNG (mulberry32) so that randomized tests are reproducible.
 */
const createRandom = (seed: number): (() => number) => {
  let state = seed;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const RANDOM_SEED = 20261006;

/**
 * Returns the numbers `0..length - 1` in a random order (Fisher-Yates), so all values are unique.
 */
const createShuffledRange = (length: number, random: () => number): number[] => {
  const values = Array.from({ length }, (_, index) => index);

  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }

  return values;
};

describe('Creation', () => {
  test('should create an empty heap', () => {
    const heap = createNumberHeap();

    assert.equal(heap.size, 0);
    assert.equal(heap.peek, undefined);
  });

  test('should create an empty heap with a custom comparator', () => {
    const heap = new MinHeap<string>((a, b) => a.length < b.length);

    assert.equal(heap.size, 0);
    assert.equal(heap.peek, undefined);
  });
});

describe('Single element', () => {
  test('should insert a single element', () => {
    const heap = createNumberHeap([42]);

    assert.equal(heap.size, 1);
    assert.equal(heap.peek, 42);
  });

  test('should delete the only element', () => {
    const heap = createNumberHeap([42]);

    assert.equal(heap.delete(42), 42);
    assert.equal(heap.size, 0);
    assert.equal(heap.peek, undefined);
  });

  test('should handle insertion after deleting the only element', () => {
    const heap = createNumberHeap([42]);

    heap.delete(42);
    heap.insert(10);

    assert.equal(heap.size, 1);
    assert.equal(heap.peek, 10);
  });
});

describe('Numbers', () => {
  test('should insert numbers', () => {
    const heap = createNumberHeap([10, 5, 20, 1, 7, 3, 15]);

    assert.equal(heap.size, 7);
    assert.equal(heap.peek, 1);
  });

  test('should handle already sorted input', () => {
    const heap = createNumberHeap([1, 2, 3, 4, 5, 6, 7, 8, 9]);

    assert.equal(heap.peek, 1);
    assert.equal(heap.size, 9);
  });

  test('should handle reverse sorted input', () => {
    const heap = createNumberHeap([9, 8, 7, 6, 5, 4, 3, 2, 1]);

    assert.equal(heap.peek, 1);
    assert.equal(heap.size, 9);
  });

  test('should handle negative numbers', () => {
    assert.equal(createNumberHeap([-5, 10, -20, 0, -1, 5]).peek, -20);
  });

  test('should handle zero', () => {
    assert.equal(createNumberHeap([10, 0, 5]).peek, 0);
  });

  test('should handle Infinity', () => {
    assert.equal(createNumberHeap([Infinity, 10, 5]).peek, 5);
  });

  test('should handle negative Infinity', () => {
    assert.equal(createNumberHeap([10, -Infinity, 5]).peek, -Infinity);
  });
});

describe('Uniqueness', () => {
  test('should throw when inserting an element that is already in the heap', () => {
    const heap = createNumberHeap([5, 2]);

    assert.throws(() => heap.insert(5), /already in the heap/);
    assert.equal(heap.size, 2);
  });

  test('should allow re-inserting an element after it was removed', () => {
    const heap = createNumberHeap([5, 2]);

    heap.delete(5);
    heap.insert(5);

    assert.deepEqual(drain(heap), [2, 5]);
  });

  test('should report membership', () => {
    const heap = createNumberHeap([5, 2]);

    assert.equal(heap.has(5), true);
    assert.equal(heap.has(7), false);

    heap.extractMin();

    assert.equal(heap.has(2), false);
  });
});

describe('Extract min', () => {
  test('should return undefined for an empty heap', () => {
    const heap = createNumberHeap();

    assert.equal(heap.extractMin(), undefined);
    assert.equal(heap.size, 0);
  });

  test('should remove and return the minimum', () => {
    const heap = createNumberHeap([10, 3, 7]);

    assert.equal(heap.extractMin(), 3);
    assert.equal(heap.size, 2);
    assert.equal(heap.peek, 7);
  });

  test('should return elements in ascending order', () => {
    const heap = createNumberHeap([10, 3, 7, 1, 8, 2, 5, 4, 6, 9]);

    assert.deepEqual(drain(heap), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('Delete', () => {
  test('should delete the root element', () => {
    const heap = createNumberHeap([10, 5, 20, 1, 7]);

    assert.equal(heap.delete(1), 1);
    assert.equal(heap.size, 4);
    assert.equal(heap.peek, 5);
  });

  test('should delete a leaf element', () => {
    const heap = createNumberHeap([1, 2, 3, 4, 5, 6, 7]);

    assert.equal(heap.delete(7), 7);
    assert.equal(heap.size, 6);
    assert.equal(heap.peek, 1);
  });

  test('should delete a middle element', () => {
    const heap = createNumberHeap([1, 3, 2, 7, 5, 8, 4]);

    assert.equal(heap.delete(5), 5);
    assert.equal(heap.size, 6);
    assert.deepEqual(drain(heap), [1, 2, 3, 4, 7, 8]);
  });

  test('should sift up the moved element when it is smaller than its new parent', () => {
    // Heap layout: [1, 10, 2, 11, 12, 3]. Deleting 11 moves 3 under 10, so it must go up.
    const heap = createNumberHeap([1, 10, 2, 11, 12, 3]);

    heap.delete(11);

    assertMinHeap(heap.toArray(), numberComparator);
    assert.deepEqual(drain(heap), [1, 2, 3, 10, 12]);
  });

  test('should not change the heap when deleting a missing element', () => {
    const heap = createNumberHeap([1, 3, 5, 7, 9]);
    const before = heap.toArray();

    assert.equal(heap.delete(100), undefined);
    assert.deepEqual(heap.toArray(), before);
  });

  test('should handle deleting from an empty heap', () => {
    const heap = createNumberHeap();

    assert.equal(heap.delete(42), undefined);
    assert.equal(heap.size, 0);
  });

  test('should preserve ordering after arbitrary deletions', () => {
    const heap = createNumberHeap([1, 3, 2, 7, 5, 8, 4, 10, 6, 9]);

    for (const value of [5, 8, 2, 10]) {
      heap.delete(value);
    }

    assert.deepEqual(drain(heap), [1, 3, 4, 6, 7, 9]);
  });
});

describe('Strings', () => {
  test('should preserve lexicographical ordering', () => {
    const heap = new MinHeap<string>((a, b) => a < b);

    for (const value of ['zebra', 'apple', 'orange', 'banana', 'kiwi']) {
      heap.insert(value);
    }

    assert.deepEqual(drain(heap), ['apple', 'banana', 'kiwi', 'orange', 'zebra']);
  });

  test('should support a custom comparator', () => {
    const heap = new MinHeap<string>((a, b) => a.length < b.length);

    for (const value of ['typescript', 'js', 'react', 'node']) {
      heap.insert(value);
    }

    assert.equal(heap.peek, 'js');
  });
});

describe('Objects', () => {
  test('should return the least-loaded worker', () => {
    const leastLoaded = { id: 'worker-4', load: 10 };
    const heap = createWorkerHeap([
      { id: 'worker-1', load: 50 },
      { id: 'worker-2', load: 20 },
      { id: 'worker-3', load: 80 },
      leastLoaded,
    ]);

    assert.equal(heap.size, 4);
    assert.equal(heap.peek, leastLoaded);
  });

  test('should return the next least-loaded worker after deletion', () => {
    const worker1 = { id: 'worker-1', load: 50 };
    const worker2 = { id: 'worker-2', load: 20 };
    const heap = createWorkerHeap([worker1, worker2, { id: 'worker-3', load: 80 }]);

    assert.equal(heap.delete(worker2), worker2);
    assert.equal(heap.peek, worker1);
  });

  test('should handle workers with equal load', () => {
    const heap = createWorkerHeap([
      { id: 'worker-1', load: 10 },
      { id: 'worker-2', load: 10 },
      { id: 'worker-3', load: 20 },
    ]);

    assert.deepEqual(
      drain(heap).map((worker) => worker.load),
      [10, 10, 20],
    );
  });

  test('should delete by reference, not by structural equality', () => {
    const worker = { id: 'worker-1', load: 10 };
    const heap = createWorkerHeap([worker]);

    assert.equal(heap.delete({ id: 'worker-1', load: 10 }), undefined);
    assert.equal(heap.size, 1);
  });

  test('should allow distinct objects with equal priority', () => {
    const heap = createWorkerHeap([
      { id: 'worker-1', load: 5 },
      { id: 'worker-2', load: 5 },
    ]);

    assert.equal(heap.size, 2);
  });
});

describe('Update', () => {
  const createWorkers = (loads: number[]): Worker[] =>
    loads.map((load, index) => ({ id: `worker-${index + 1}`, load }));

  test('should move an element up after its priority decreased', () => {
    const workers = createWorkers([10, 20, 30, 40, 50]);
    const heap = createWorkerHeap(workers);

    workers[4].load = 1;

    assert.equal(heap.update(workers[4]), true);
    assert.equal(heap.peek, workers[4]);
    assertMinHeap(heap.toArray(), workerComparator);
  });

  test('should move an element down after its priority increased', () => {
    const workers = createWorkers([10, 20, 30, 40, 50]);
    const heap = createWorkerHeap(workers);

    workers[0].load = 100;

    assert.equal(heap.update(workers[0]), true);
    assert.equal(heap.peek, workers[1]);
    assert.deepEqual(
      drain(heap).map((worker) => worker.id),
      ['worker-2', 'worker-3', 'worker-4', 'worker-5', 'worker-1'],
    );
  });

  test('should keep the heap intact when the priority did not change', () => {
    const workers = createWorkers([10, 20, 30]);
    const heap = createWorkerHeap(workers);
    const before = heap.toArray();

    assert.equal(heap.update(workers[1]), true);
    assert.deepEqual(heap.toArray(), before);
  });

  test('should return false for an element that is not in the heap', () => {
    const heap = createWorkerHeap(createWorkers([10, 20]));

    assert.equal(heap.update({ id: 'worker-x', load: 1 }), false);
    assert.equal(heap.size, 2);
  });

  test('should return false for an element that was removed', () => {
    const workers = createWorkers([10, 20]);
    const heap = createWorkerHeap(workers);

    heap.extractMin();

    assert.equal(heap.update(workers[0]), false);
  });
});

describe('Edge cases', () => {
  test('should sort a large number of elements', () => {
    const values = createShuffledRange(10_000, createRandom(RANDOM_SEED));
    const heap = createNumberHeap(values);

    assert.equal(heap.size, 10_000);
    assert.deepEqual(
      drain(heap),
      values.toSorted((a, b) => a - b),
    );
  });

  test('should handle alternating insertions and extractions', () => {
    const heap = createNumberHeap([10, 5]);

    assert.equal(heap.extractMin(), 5);
    assert.equal(heap.peek, 10);

    heap.insert(3);
    heap.insert(7);

    assert.equal(heap.extractMin(), 3);
    assert.equal(heap.peek, 7);

    heap.insert(1);

    assert.equal(heap.peek, 1);
  });

  test('should stay consistent under random inserts, deletes and updates', () => {
    type Item = { priority: number };

    const random = createRandom(RANDOM_SEED);
    const itemComparator: HeapComparator<Item> = (a, b) => a.priority < b.priority;
    const heap = new MinHeap<Item>(itemComparator);
    const present = new Set<Item>();

    for (let step = 0; step < 5_000; step++) {
      const items = [...present];
      const operation = items.length === 0 ? 0 : Math.floor(random() * 3);

      if (operation === 0) {
        const item = { priority: Math.floor(random() * 1_000) };

        heap.insert(item);
        present.add(item);
      } else {
        const item = items[Math.floor(random() * items.length)];

        if (operation === 1) {
          assert.equal(heap.delete(item), item);
          present.delete(item);
        } else {
          item.priority = Math.floor(random() * 1_000);
          assert.equal(heap.update(item), true);
        }
      }

      assertMinHeap(heap.toArray(), itemComparator);
    }

    assert.equal(heap.size, present.size);
    assert.deepEqual(
      drain(heap).map((item) => item.priority),
      [...present].map((item) => item.priority).toSorted((a, b) => a - b),
    );
  });

  test('should preserve min-heap property after random operations', () => {
    const values = createShuffledRange(1_000, createRandom(RANDOM_SEED));
    const heap = createNumberHeap();

    for (const value of values) {
      heap.insert(value);
      assertMinHeap(heap.toArray(), numberComparator);
    }

    for (const value of values.slice(0, 500)) {
      assert.equal(heap.delete(value), value);
      assertMinHeap(heap.toArray(), numberComparator);
    }

    assert.equal(heap.size, 500);
  });

  test('should remain usable after becoming empty multiple times', () => {
    const heap = createNumberHeap();

    for (let cycle = 0; cycle < 5; cycle++) {
      heap.insert(3);
      heap.insert(1);
      heap.insert(2);

      assert.deepEqual(drain(heap), [1, 2, 3]);
      assert.equal(heap.peek, undefined);
    }
  });
});
