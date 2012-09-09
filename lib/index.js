
// Patch the {fs|path}.exists functions
require('exists-patch').patch();

var ps      = require('ps');
var consts  = require('consts');
var config  = require('node-conf');
var redis   = require('redis-url');
var path    = require('path');
var ids     = require('short-id');
var child   = require('child_process');

// Define some application constants
consts.define(exports, 'ENV',           process.env.NODE_ENV || 'production');
consts.define(exports, 'NODES_PATH',    path.join(__dirname, '..'));
consts.define(exports, 'BASE_PATH',     process.cwd());
consts.define(exports, 'CONFIG_PATH',   path.join(exports.BASE_PATH, 'config');
consts.define(exports, 'PROC_PATH',     path.join(exports.BASE_PATH, 'procs');
consts.define(exports, 'SETUP_FILE',    path.join(exports.BASE_PATH, 'setup.js');
consts.define(exports, 'STATE_FILE',    path.join(exports.BASE_PATH, 'procs.json');
consts.define(exports, 'PING_RATE',     10000);
consts.define(exports, 'EVENT_DELIM',   '::');
consts.define(exports, 'BROADCAST_CH',  'broadcast');

// After the bootstrap, this will contain the process object
exports.proc = null;

// Load the application config
exports.config = config.load(exports.ENV);

// The bootstrap function - initializes redis-nodes system
exports.bootstrap = function(procName) {
	exports.proc = new Proc(procName);
};

// Kills a running process
exports.kill = function(procName, callback) {
	exports.state.read(function(err, state) {
		if (err) {
			return callback(err);
		}
		var pid = state.pids[procName];
		if (pid) {
			process.kill(pid, 'SIGTERM');
			delete state.pids[procName];
			exports.state.write(state, function(err) {
				callback(err, state);
			});
		} else {
			callback(null, state);
		}
	});
};

// Spawns a new process for the given proc name
exports.spawn = function(procName, callback) {
	exports.state.read(function(err, state) {
		if (err) {
			return callback(err);
		}
		var bin = path.join(exports.PROC_PATH, 'start.js');
		var env = {NODE_ENV: exports.ENV};
		var proc = child.spawn(bin, [ ], {cwd: exports.BASE_PATH, env: env});
		proc.stdout.on('data', function(data) {
			process.stdout.write(data);
		});
		proc.stderr.on('data', function(data) {
			process.stderr.write(data);
		});
		state.pids[procName] = proc.pid;
		exports.state.write(state, function(err) {
			if (err) {
				return callback(err);
			}
			callback(null, proc);
		});
	});
};

// ------------------------------------------------------------------

// Checks every few seconds if a process is still running and restarts
// if the process goes down
var Spawner = exports.Spawner = function(procName) {
	this.procName  = procName;
	this.timer     = null;
	this.stopped   = false;
	
	var runCheck = function() {
		this.getPid(function(err, pid) {
			if (err) {
				return console.error(err);
			}
			ps.lookup({ pid: pid }, function(err, proc) {
				if (err) {
					return console.error(err);
				}
				if (proc !== 'node') {
					exports.spawn(this.procName, next);
				} else {
					next();
				}
				function next(err) {
					if (err) {
						console.error(err);
					}
					if (! this.stopped) {
						this.timer = setTimeout(runCheck, exports.PING_RATE);
					}
				}
			});
		}.bind(this));
	}.bind(this);
	
	runCheck();
};

Spawner.prototype.stop = function() {
	clearTimeout(this.timer);
	this.stopped = true;
};

Spawner.prototype.kill = function(callback) {
	callback = callback || function() { };
	this.getPid(function(err, pid) {
		if (err) {
			return callback(err);
		}
		process.kill(pid, 'SIGTERM');
	});
};

Spawner.prototype.getPid = function(callback) {
	var proc = this.procName;
	exports.state.read(function(err, state) {
		if (err) {
			return callback(err);
		}
		callback(null, state.pids[proc]);
	});
};

// ------------------------------------------------------------------
//  State file managment

exports.state = {
	read: function(callback) {
		fs.readFile(exports.STATE_FILE, 'utf8', function(err, json) {
			if (err) {
				return callback(err);
			}
			callback(null, exports.state._decode(json));
		});
	},
	write: function(data, callback) {
		fs.writeFile(exports.STATE_FILE, exports.state._encode(data), callback);
	},
	readSync: function() {
		var json = fs.readFileSync(exports.STATE_FILE, 'utf8');
		return exports.state._decode(json);
	},
	writeSync: function(data) {
		fs.writeFileSync(exports.STATE_FILE, exports.state._encode(data));
	},
	_empty: {
		procs: [ ],
		disabled: [ ],
		pids: { }
	},
	_encode: function(data) {
		return JSON.stringify(data || exports.state._empty);
	},
	_decode: function(json) {
		return json ? JSON.parse(json) : exports.state._empty;
	}
};

// ------------------------------------------------------------------
//  Proc constructor

function Proc(name) {
	
	EventEmitter2.call(this, {
		wildcard: true,
		delimiter: exports.EVENT_DELIM,
		maxListeners: 0
	});
	
// Overwrite the emit method to do redis magic stuff
	
	this._emit = this.emit;
	this.emit = function(event, data, callback) {
		// FIXME joining an array just to re-split is really ineficient, but we have to
		// deal with events as strings, so I can't think of another way at the moment.
		
		if (Array.isArray(event) {
			event = event.join(exports.EVENT_DELIM);
		}
		
		var channel = event.split(exports.EVENT_DELIM)[0];
		if (channel === '*') {
			channel = exports.BROADCAST_CH;
		}
		
		var message = {
			source: this.name,
			event: event,
			data: data,
			id: ids.store(callback)
		};
		
		this._publish(channel, message);
	};

// Define the `name` parameter as non-writable
	
	consts.define(this, 'name', name);
	
// Open the redis clients
	
	this._outputClient = this._createClient();
	
	this._broadcastClient = this._createClient(function(client) {
		client.on('message', this._onBroadcast.bind(this));
		client.subscribe(exports.BROADCAST_CH);
	});
	
	this._directMessageClient = this._createClient(function(client) {
		client.on('message', this._onDirectMessage.bind(this));
		client.subscribe(this.name);
	});
	
}

Proc.prototype = new EventEmitter2();

// ------------------------------------------------------------------
//  Redis client creation

Proc.prototype._createClient = function(whenReady) {
	var client = redis.connect(exports.config._core.redis);
	client.on('error', function(err) {
		throw err;
	});
	if (typeof whenReady === 'function') {
		whenReady = whenReady.bind(this);
		client.on('ready', function() {
			whenReady(client);
		});
	}
	return client;
};

// ------------------------------------------------------------------
//  Message body encoding

/*

  These are used for encoding/decoding messages for redis transport.
  If you wish to use an encoding method other than JSON, these methods
  should be overriden in the application's {setup.js} file.

*/

Proc.prototype._encode = function(data) {
	return JSON.stringify(data);
};

Proc.prototype._decode = function(data) {
	return JSON.parse(data);
};

// ------------------------------------------------------------------
//  Redis pub/sub IO

/*

  Raw message structure:
    {
      "id": "24e04e",
      "event": "some-event-name",
      "data": {...},
      "source": "proc-name"
    }

  Raw reply message structure:
    {
      "id": "24e04e",
      "event": "_reply",
      "args": [...]
    }

*/

Proc.prototype._publish = function(channel, message) {
	this._outputClient.publish(channel, this._encode(message));
};

Proc.prototype._onBroadcast = function(channel, message) {
	message = this._decode(message);
	var event = message.source + '::' + message.event;
	this._emit(event, message.data, this._reply(message));
};

Proc.prototype._onDirectMessage = function(channel, message) {
	message = this._decode(message);
	// Handle reply events
	if (message.event === '_reply') {
		var callback = ids.fetchAndInvalidate(message.id);
		if (typeof callback === 'function') {
			callback.apply(this, args);
		}
	}
	// Handle other events
	else {
		var event = message.source + exports.EVENT_DELIM + message.event;
		this._emit(event, message.data, this._reply(message));
	}
};

Proc.prototype._reply = function(message) {
	var replyer = function() {
		var args = slice(arguments);
		this._publish(message.source, {
			event: '_reply',
			id: message.id,
			args: args
		});
	};
	return replyer.bind(this);
};

// ------------------------------------------------------------------

function slice(arr, start) {
	return Array.prototype.slice.call(arr, start);
}

