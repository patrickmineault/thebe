importScripts("https://cdn.jsdelivr.net/pyodide/v0.18.0/full/pyodide.js");

let initPromise = null;

function formatError(e) {
  let lines = e.split("\n");
  let ename = lines[lines.length - 1].split(':');
  let payload = {traceback: lines, ename: ename[0], evalue: ename[1]}
  return payload;
}

self.init = async (context) => {
	self.pyodide = await loadPyodide({
		indexURL: context.baseUrl,
	});
	self.postMessage({type: 'ready'});
}

self.onmessage = async (event) => {
  const { type, ...context } = event.data;

  if(type == 'init') {
    initPromise = init(context);
  } else if(type == 'run') {
    await initPromise;
		let python = context.code;
    let header = context.header;

    let msg = (type, payload, channel='iopub') => {
      let m = {
        msg_type: type,
        header: {
          msg_type: type,
        },
        content: payload,
        parent_header: header,
        channel: channel
      }
      console.log(m);
      self.postMessage(m);
    }

    // Now is the easy part, the one that is similar to working in the main thread:
    msg('status', {execution_state: 'busy'});
    msg('execute_input', {code: python});
    
    let result = null;
    let error = null;
    self.pyodide.runPython("import sys, io\nsys.stdout = io.StringIO()");
    try {
			result = self.pyodide.runPython(python);  
    } catch (e) {
      error = e;
    }

    let stdout = self.pyodide.runPython('sys.stdout.getvalue()');
    if(stdout != '') {
      msg('stream', {name: "stdout", text: stdout});
    }

    if(error != null) {
      console.log(error)
      let payload = formatError(error.message);
      msg('error', payload);
    }

    if(result != null) {
      msg('execute_result', {data: {'text/plain': result.toString()}});
    }

    msg('execute_reply', {'status': 'ok', 'payload': [], 'execution_count': 0}, 'shell');
    msg('status', {execution_state: 'idle'});
	}
}