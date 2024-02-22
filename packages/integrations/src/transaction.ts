import { convertIntegrationFnToClass } from '@sentry/core';
import type { Event, Integration, IntegrationClass, IntegrationFn, StackFrame } from '@sentry/types';

const INTEGRATION_NAME = 'Transaction';

const transactionIntegration = (() => {
  return {
    name: INTEGRATION_NAME,
    // TODO v8: Remove this
    setupOnce() {}, // eslint-disable-line @typescript-eslint/no-empty-function
    processEvent(event) {
      const frames = _getFramesFromEvent(event);

      // use for loop so we don't have to reverse whole frames array
      for (let i = frames.length - 1; i >= 0; i--) {
        const frame = frames[i];

        if (frame.in_app === true) {
          event.transaction = _getTransaction(frame);
          break;
        }
      }

      return event;
    },
  };
}) satisfies IntegrationFn;

/**
 * Add node transaction to the event.
 * @deprecated This integration will be removed in v8.
 */
// eslint-disable-next-line deprecation/deprecation
export const Transaction = convertIntegrationFnToClass(INTEGRATION_NAME, transactionIntegration) as IntegrationClass<
  Integration & { processEvent: (event: Event) => Event }
>;

function _getFramesFromEvent(event: Event): StackFrame[] {
  const exception = event.exception && event.exception.values && event.exception.values[0];
  return (exception && exception.stacktrace && exception.stacktrace.frames) || [];
}

function _getTransaction(frame: StackFrame): string {
  return frame.module || frame.function ? `${frame.module || '?'}/${frame.function || '?'}` : '<unknown>';
}