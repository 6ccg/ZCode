// Computer Use component bridge. MIT license: see LICENSE.
var CuaHelperLifecycleManager = class {
  #stopInstance;
  #current;
  #retiring;
  #terminal = false;
  #transitionTail = Promise.resolve();
  #disposePromise;
  constructor(stopInstance) {
    this.#stopInstance = stopInstance;
  }
  get disposed() {
    return this.#terminal;
  }
  isCurrent(candidate) {
    return !this.#terminal && this.#current === candidate;
  }
  peek() {
    return this.#terminal ? void 0 : this.#current;
  }
  acquire(options) {
    return this.#enqueue(async () => {
      if (!this.#terminal && (await this.#finishRetiringInstance(), !this.#terminal)) {
        if (typeof options?.isAdmitted == "function" && !options.isAdmitted()) {
          await this.#stopCurrentIfNeeded(options.shouldRetainCurrent);
          return;
        }
        return (this.#current || (this.#current = options.create()), this.#current);
      }
    });
  }
  reconcile(options) {
    return this.#enqueue(async () => {
      this.#terminal ||
        (await this.#finishRetiringInstance(),
        this.#terminal ||
          (await this.#stopCurrentIfNeeded(options?.shouldRetainCurrent ?? (() => false))));
    });
  }
  dispose() {
    return this.#disposePromise
      ? this.#disposePromise
      : ((this.#terminal = true),
        (this.#disposePromise = this.#enqueue(async () => {
          let current = this.#current,
            retiring = this.#retiring;
          ((this.#current = void 0), (this.#retiring = void 0));
          let instances = [retiring, current].filter(
              (item, index, all) => item !== void 0 && all.indexOf(item) === index,
            ),
            failures = [];
          for (let instance of instances)
            try {
              await this.#stopInstance?.(instance);
            } catch (error) {
              failures.push(error);
            }
          if (failures.length === 1) throw failures[0];
          if (failures.length > 1)
            throw new AggregateError(failures, "Failed to stop Computer Use Helper instances");
        })),
        this.#disposePromise);
  }
  async #stopCurrentIfNeeded(shouldRetainCurrent) {
    let current = this.#current;
    current &&
      (shouldRetainCurrent?.(current) ||
        ((this.#current = void 0),
        (this.#retiring = current),
        await this.#finishRetiringInstance()));
  }
  async #finishRetiringInstance() {
    let retiring = this.#retiring;
    retiring &&
      (await this.#stopInstance?.(retiring),
      this.#retiring === retiring && (this.#retiring = void 0));
  }
  #enqueue(operation) {
    let queued = this.#transitionTail.then(operation, operation);
    return (
      (this.#transitionTail = queued.then(
        () => {},
        () => {},
      )),
      queued
    );
  }
};
export { CuaHelperLifecycleManager };
