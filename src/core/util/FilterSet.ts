/** TODO: Document filter */
export type Filter<T, T2 extends T> = (item: T) => item is T2;

/** A set that will only inlcude things that match the filter */
export default class FilterSet<T, T2 extends T> implements Iterable<T2> {
  private items: Set<T2> = new Set();

  constructor(private predicate: Filter<T, T2>) {}

  addIfValid(item: T) {
    if (this.predicate(item)) {
      this.items.add(item);
    }
  }

  remove(item: T) {
    if (this.predicate(item)) {
      this.items.delete(item);
    }
  }

  get size() {
    return this.items.size;
  }

  [Symbol.iterator]() {
    return this.items[Symbol.iterator]();
  }
}
