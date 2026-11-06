import {domainError} from '../domain/errors.js';

const promised=value=>value&&typeof value.then==='function';

// Preserve the synchronous API while sharing the exact transaction steps with
// callers that must await native observation before committing ownership.
export function runTransactionWorkflow(iterator,{async=false}={}) {
  if(async)return (async()=>{
    let method='next',value;
    for(;;){const step=iterator[method](value);if(step.done)return step.value;
      try{value=await step.value;method='next';}catch(error){value=error;method='throw';}}
  })();
  let method='next',value;
  for(;;){const step=iterator[method](value);if(step.done)return step.value;
    try {
      if(promised(step.value)){Promise.resolve(step.value).catch(()=>{});throw domainError('ASYNC_DEPLOYMENT_REQUIRED','Use the asynchronous deployment service for native observation');}
      value=step.value;method='next';
    }catch(error){value=error;method='throw';}
  }
}

export function withTransactionCleanup(action,cleanup) {
  let deferred=false;
  try{const result=action();if(promised(result)){deferred=true;return Promise.resolve(result).finally(cleanup);}return result;}
  finally{if(!deferred)cleanup();}
}
