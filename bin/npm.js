
var cp = require('child_process');
var consts = require('consts');

var exports = module.exports = function() {
	return runNpm.apply(this, arguments);
};

consts.define(exports, 'STREAM_OUTPUT', 1);

// ------------------------------------------------------------------

var Dir = exports.Dir = function(dir) {
	this.dir = dir;
};

Dir.prototype.run = function(args, callbacks, callback) {
	args = slice(arguments);
	args.splice(1, 0, this.dir);
	runNpm.apply(null, args);
};

Dir.prototype.install = function(module, flags, callback) {
	exports.install(module, this.dir, flags, callback);
};

// ------------------------------------------------------------------

exports.install = function(module, cwd, flags, callback) {
	var args = ['install', module].concat(flags);
	exports(args, cwd, exports.STREAM_OUTPUT, callback);
};












// ------------------------------------------------------------------

function slice(arr) {
	return Array.prototype.slice.call(arr);
}

// ------------------------------------------------------------------

function runNpm(args, cwd, callbacks, callback) {
	args.unshift('git');
	var proc = cp.spawn('/usr/bin/env', args, { cwd: cwd });
	if (callbacks === exports.STREAM_OUTPUT) {
		callbacks = {
			stdout: function(data) {
				process.stdout.write(data);
			},
			stderr: function(data) {
				process.stderr.write(data);
			}
		};
	}
	if (callbacks) {
		procs.stdout.on('data', callbacks.stdout);
		procs.stderr.on('data', callbacks.stderr);
	}
	if (callback) {
		proc.on('exit', callback);
	}
}

