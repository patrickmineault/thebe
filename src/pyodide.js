import * as events from "./events";
import { mergeOptions } from "./options";
import { PromiseDelegate } from '@lumino/coreutils';
import { KernelFutureHandler } from "@jupyterlab/services/lib/kernel/future";

/* 
This hyper-experimental kernel uses pyodide rather than a remote server. 
It's ripped from kernels/requestKernel 
*/
export function requestPyodideKernel(kernelOptions) {
  kernelOptions = mergeOptions({ kernelOptions }).pyodideOptions;
  events.trigger("status", {
    status: "starting",
    message: "Starting Pyodide Kernel",
  });
  let km = new PyodideKernelManager(kernelOptions);
  return km.ready
    .then(() => {
      return km.startNew(kernelOptions);
    })
    .then((kernel) => {
      events.trigger("status", {
        status: "ready",
        message: "Kernel is ready",
        kernel: kernel,
      });
      return kernel;
    });
	}
	
	/*
	Inspired by manager.d.ts and kernel.d.ts
	*/
export class PyodideKernelManager {
  constructor(kernelOptions) {
    this.kernelOptions = kernelOptions;
    this.init();
  }

  init() {
    this._connection = new PyodideKernelConnection(this.kernelOptions);
    this.ready = this._connection.ready;
  }

  startNew() {
    /* Immediately resolve */
    return new Promise((resolve, reject) => resolve(this._connection));
  }
}

export class PyodideKernelConnection {
  constructor(kernelOptions) {
    this.kernelOptions = kernelOptions;
    this.init();
    this._targetRegistry = {};
    this.msgId = 0;
  }

  init() {
    // Start the kernel.
    this._worker = new Worker('/src/pyodide-worker.js')
    this.ready = new Promise((resolve, reject) => {
      this._worker.onmessage = (e) => {
        resolve();
      };
      this._worker.postMessage(
        {'type': 'init',
         'baseUrl': this.kernelOptions.baseUrl}
      );   
    });
  }

  registerCommTarget(targetName, callback) {
    this._targetRegistry[targetName] = callback;
  }

  async requestCommInfo() {
    return {'content': {'status': 'ok', 'comms': {'pyodide': ''}}};
  }

  handleMessage(e) {
    console.log("Handling message from web worker");
    console.log(e);
  }

  createComm(targetName, modelId) {
    return new PyodideComm(this._worker);
  }

  requestExecute(content, disposeOnDone, metadata) {
    this.msgId++;
    let msg = this.constructMsg(this.msgId);
    let future = new KernelFutureHandler(() => {}, msg);
    this._worker.postMessage(
      {'type': 'run',
       'code': content.code,
       'header': msg.header
     }
    )
    this._worker.onmessage = (msg) => {
      future.handleMsg(msg.data);
    }
    return future;
  }

  constructMsg(msgId) {
    return {'header': {
      'msg_id': msgId,
      'msg_type': 'execute_request',
    },
    'channel': 'shell'}
  }

  restart() {
    console.log("In restart");
    if(this._worker != null) {
      // A little drastic but don't have a much better idea given
      // https://github.com/pyodide/pyodide/issues/703
      this._worker.terminate();
      return this.init();
    }
  }
}

/* I'm not sure how to deal with these extra control signals, so for now, create stubs */
export class PyodideComm {
  constructor(_worker) {
    this._worker = _worker;
  }

  set on_msg(cb) {
    this._cb = cb;
  }

  send(msg, callbacks) {
    msg.header = {};
    return new Future(msg, callbacks);
  }
}

class Future {
  constructor(msg, cbs) {
    this.cbs = cbs;
    this.msg = msg;
    this._done = new PromiseDelegate();
    this._reply = () => {};
    this._iopub = () => {};
  }

  get onReply() {
    return this._reply
  }

  set onReply(cb) {
    this._reply = cb;
  }

  get onIOPub() {
    return this._iopub;
  }

  set onIOPub(cb) {
    this._iopub = cb;
  }

  get done() {
    return this._done.promise;
  }

  resolve(msg) {
    this._done.resolve(msg);
  }

  dispose() {

  }
}