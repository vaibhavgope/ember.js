import { DEBUG } from '@glimmer/env';
import { assert as emberAssert } from '@ember/debug';
import { checkTest, DebugEnv, DebugFunction, DebugFunctionOptions } from './utils';

type Actual = [string, boolean, DebugFunctionOptions];
type Message = string | RegExp;
type OptionList = ReadonlyArray<string> | undefined;

export default class MethodCallTracker {
  private _env: DebugEnv;
  private _methodName: string;
  private _isExpectingNoCalls: boolean;
  private _expectedMessages: Message[];
  private _expectedOptionLists: OptionList[];
  private _actuals: Actual[];
  private _originalMethod: DebugFunction | undefined;

  constructor(env: DebugEnv, methodName: string) {
    this._env = env;
    this._methodName = methodName;
    this._isExpectingNoCalls = false;
    this._expectedMessages = [];
    this._expectedOptionLists = [];
    this._actuals = [];
    this._originalMethod = undefined;
  }

  stubMethod(): void {
    if (this._originalMethod) {
      // Method is already stubbed
      return;
    }

    let env = this._env;
    let methodName = this._methodName;

    this._originalMethod = env.getDebugFunction(methodName);

    env.setDebugFunction(methodName, (message, test, options) => {
      let resultOfTest = checkTest(test);

      this._actuals.push([message, resultOfTest, options]);
    });
  }

  restoreMethod(): void {
    if (this._originalMethod) {
      this._env.setDebugFunction(this._methodName, this._originalMethod);
    }
  }

  expectCall(message?: Message, options?: OptionList): void {
    this.stubMethod();
    this._expectedMessages.push(message || /.*/);
    this._expectedOptionLists.push(options);
  }

  expectNoCalls(): void {
    this.stubMethod();
    this._isExpectingNoCalls = true;
  }

  isExpectingNoCalls(): boolean {
    return this._isExpectingNoCalls;
  }

  isExpectingCalls(): boolean | number {
    return !this._isExpectingNoCalls && this._expectedMessages.length;
  }

  assert(): void {
    let { assert } = QUnit.config.current;
    let methodName = this._methodName;
    let isExpectingNoCalls = this._isExpectingNoCalls;
    let expectedMessages = this._expectedMessages;
    let expectedOptionLists = this._expectedOptionLists;
    let actuals = this._actuals;
    let o, i;

    if (!isExpectingNoCalls && expectedMessages.length === 0 && actuals.length === 0) {
      return;
    }

    if (!DEBUG) {
      assert.ok(true, `calls to Ember.${methodName} disabled in production builds.`);
      return;
    }

    if (isExpectingNoCalls) {
      let actualMessages = [];
      for (let actual in actuals) {
        if (!actual[1]) {
          actualMessages.push(actual[0]);
        }
      }
      assert.ok(
        actualMessages.length === 0,
        `Expected no Ember.${methodName} calls, got ${actuals.length}: ${actualMessages.join(', ')}`
      );
      return;
    }

    let actual: Actual | undefined;
    let match: Actual | undefined = undefined;
    let matched: Set<number> = new Set();

    for (o = 0; o < expectedMessages.length; o++) {
      const expectedMessage = expectedMessages[o];
      const expectedOptionList = expectedOptionLists[o];

      for (i = 0; i < actuals.length; i++) {
        let matchesMessage = false;
        let matchesOptionList = false;
        actual = actuals[i];
        emberAssert('has actual', actual); // We just checked the array

        if (actual[1] === true) {
          continue;
        }

        if (expectedMessage instanceof RegExp && expectedMessage.test(actual[0])) {
          matchesMessage = true;
        } else if (expectedMessage === actual[0]) {
          matchesMessage = true;
        }

        if (expectedOptionList === undefined) {
          matchesOptionList = true;
        } else if (actual[2]) {
          matchesOptionList = true;

          for (let expectedOption of expectedOptionList) {
            matchesOptionList =
              matchesOptionList && Object.prototype.hasOwnProperty.call(actual[2], expectedOption);
          }
        }

        if (matchesMessage && matchesOptionList) {
          match = actual;
          matched.add(i);
          continue;
        }
      }

      const expectedOptionsMessage = expectedOptionList
        ? `and options: { ${expectedOptionList.join(', ')} }`
        : 'and no options';
      const actualOptionsMessage =
        actual && actual[2]
          ? `and options: { ${Object.keys(actual[2]).join(', ')} }`
          : 'and no options';

      if (!actual) {
        assert.ok(
          false,
          `Received no Ember.${methodName} calls at all, expecting: ${expectedMessage}`
        );
      } else if (match && !match[1]) {
        assert.ok(true, `Received failing Ember.${methodName} call with message: ${match[0]}`);
      } else if (match && match[1]) {
        assert.ok(
          false,
          `Expected failing Ember.${methodName} call, got succeeding with message: ${match[0]}`
        );
      } else if (actual[1]) {
        assert.ok(
          false,
          `Did not receive failing Ember.${methodName} call matching '${expectedMessage}' ${expectedOptionsMessage}, last was success with '${actual[0]}' ${actualOptionsMessage}`
        );
      } else if (!actual[1]) {
        assert.ok(
          false,
          `Did not receive failing Ember.${methodName} call matching '${expectedMessage}' ${expectedOptionsMessage}, last was failure with '${actual[0]}' ${actualOptionsMessage}`
        );
      }
    }

    for (i = 0; i < actuals.length; i++) {
      if (!matched.has(i) && actuals[i]![1] !== true) {
        assert.ok(false, `Unexpected Ember.${methodName} call: ${actuals[i]![0]}`);
      }
    }
  }
}
