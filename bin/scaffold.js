
var fs          = require('fs');
var pkg         = require('pkg');
var path        = require('path');
var async       = require('async');
var git         = require('gitjs');
var wrench      = require('wrench');
var consts      = require('consts');
var command     = require('command');
var json        = require('json-file');
var handlebars  = require('handlebars');

consts.define('TEMPLATES',    path.join(__dirname, '../templates'));
consts.define('APPLICATION',  path.join(__dirname, '../application'));
consts.define('NOT_EMPTY',    'The given directory exists and is not empty.');

exports.init = function(dir, opts, callback) {
	async.series([
		mkdir(dir),
		copyContents(consts.APPLICATION, dir),
		opts.git ? initGit(dir) : _void
	],
	function(err) {
		if (err) {
			return callback(err);
		}
		if (opts.npm) {
			return callback(null, exports.project(dir));
		}
		callback(null);
	});
};

exports.project = function(cwd) {
	return new Project(cwd);
};

// ------------------------------------------------------------------
//  Project constructor

var Project = exports.Project = function(cwd) {
	this.cwd        = cwd;
	this.root       = getProjectRoot(cwd);
	this.pkgFile    = pkg.read(this.path('package.json'));
	this.stateFile  = new json.File(this.path('procs.json'));
};

Project.prototype.path = function() {
	return path.join.apply(path, [this.root].concat(arguments));
};

Project.prototype.incrementVersion = function(release) {
	this.pkgFile.incVersion(release);
	this.pkgFile.writeSync();
};

Project.prototype.createProc = function(opts, callback) {
	if (typeof opts === 'string') {
		opts = {name: opts};
	}
	
	opts.localEvents = opts.localEvents || [ ];
	opts.globalEvents = opts.globalEvents || [ ];
	opts.events = opts.localEvents
		.map(localEventName(opts.name))
		.concat(opts.globalEvents.map(globalEventName));
	
	var rendered = renderTemplate('start.js.hbs', opts);
	mkdir(this.path(opts.name), function(err) {
		if (err) {
			return callback(err);
		}
		fs.writeFile(this.path(opts.name, 'start.js'), rendered, callback);
	});
};

Project.prototype.destroyProc = function(procName, callback) {
	wrench.rmdirRecursive(this.path(procName), callback);
};

Project.prototype.disableProc = function(procName, callback) {
	var pkgFile = json.read(this.path('procs.json'), function() {
		var disabled = pkgFile.get('disabled');
		if (disabled.indexOf(procName) < 0) {
			disabled.push(procName);
		}
		pkgFile.write(callback);
	});
};

Project.prototype.enableProc = function(procName, callback) {
	var pkgFile = json.read(this.path('procs.json'), function() {
		var disabled = pkgFile.get('disabled');
		var index = disabled.indexOf(procName);
		if (index >= 0) {
			disabled.splice(index, 1);
		}
		pkgFile.write(callback);
	});
};

Project.prototype.start = function(options) {
	var cmd = command.open(this.root);
	if (options.output) {
		cmd.on('stdout', command.writeTo(process.stdout));
		cmd.on('stderr', command.writeTo(process.stderr));
	}
	cmd.exec('node', [path.join(this.root, 'start.js')]);
	if (options.output) {
		cmd.then(function() {
			process.exit(0);
		});
	}
};

Project.prototype.stop = function(callback) {
	var stateFile = this.stateFile;
	stateFile.read(function(err) {
		if (err) {
			return callback(err);
		}
		var pids = stateFile.get('pids');
		Object.keys(pids).forEach(function(proc) {
			process.kill(pids[proc], 'SIGINT');
		});
		stateFile.set('pids', { });
		stateFile.write(callback);
	});
};

// ------------------------------------------------------------------

function mkdir(dir, callback) {
	var func = function(done) {
		fs.exists(dir, function(exists) {
			if (! exists) {
				wrench.mkdirRecursive(dir, 0777, done);
			} else {
				fs.readdir(dir, function(err, files) {
					if (! err) {
						err = files.length ? consts.NOT_EMPTY : null;
					}
					done(err);
				});
			}
		});
	};
	if (typeof callback === 'function') {
		return func(callback);
	} else {
		return func;
	}
}

function copyContents(from, to) {
	return function(done) {
		fs.readdir(from, function(err, files) {
			if (err) {
				return done(err);
			}
			files.forEach(function(file) {
				var filePath = path.join(from, file);
				var destPath = path.join(to, file);
				fs.stat(filePath, function(err, stats) {
					if (err) {
						return callback(err);
					}
					if (stats.isDirectory()) {
						wrench.copyDirRecursive(filePath, destPath, done);
					} else {
						copyFile(filePath, destPath, done);
					}
				});
			});
		});
	};
}

function copyFile(from, to, callback) {
	fs.readFile(from, function(err, data) {
		if (err) {
			return callback(err);
		}
		fs.writeFile(to, data, callback);
	});
}

// ------------------------------------------------------------------

function initGit(dir) {
	return function(done) {
		git.init(dir, done);
	};
}

function getProjectRoot(cwd) {
	return findUpTree(cwd, 'procs.json');
}

function findUpTree(current, find) {
	var file = path.join(current, find);
	if (fs.existsSync(file)) {
		return current;
	}
	if (current === '/') {
		return null;
	}
	current = path.join(current, '..');
	return findUpTree(current, find);
}

function _void() {
	return void(0);
}

function globalEventName(event) {
	return '*::' + event;
}

function localEventName(proc) {
	return function(event) {
		return proc + '::' + event;
	};
}

function renderTemplate(file, data) {
	var template = fs.readFileSync(path.join(consts.TEMPLATES, file), 'utf8');
	template = handlebars.compile(template);
	return template(data);
}


























