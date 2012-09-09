#!/usr/bin/env node

// Patch the {fs|path}.exists functions
require('exists-patch').patch();

var fs        = require('fs');
var path      = require('path');
var async     = require('async');
var program   = require('commander');
var output    = require('./output');
var pkg       = require('package');
var command   = require('command');

// Handle Error Outputting
process.on('uncaughtException', function(err) {
	if (err instanceof Error) {
		err = (program.stack)
			? err.stack
			: err.name + ': ' + err.message;
	}
	output.error(String(err));
	process.exit(1);
});

var cwd = process.cwd();
var pkgFile = pkg.read('../package.json');

// Define the basic options
program
	.version(pkgFile.version())
	.option('-q, --quiet', 'No output')
	.option('-C, --no-color', 'No color output')
	.option('-s, --stack', 'Output stack trace with error messages');

// ------------------------------------------------------------------
//  $ nodes init [--with-git] [--with-npm]

program
	.command('init')
	.description('Create a new redis-nodes project')
	.option('-g, --with-git', 'Initialize a git repo')
	.option('-n, --with-npm', 'Provide prompts to setup you package.json file')
	.action(function(options) {
		parseOptions();
		output.log.nolf('Creating redis-nodes project...');
		var opts = {git: options.withGit, npm: options.withNpm};
		scaffold.init(cwd, opts, function(err, pkgFile) {
			if (err) {
				output.log('');
				throw err;
			}
			output.log(' Done.'.blue);
			
			if (opts.npm) {
				output.log('Fill in your projects package.json info');
				program.prompt({
					name: 'name: ',
					description: 'description: ',
					author: 'author: ',
					keywords: 'keywords: ',
					dependencies: 'dependencies (foo,bar@1.0.0,baz): '
				}, function(values) {
					process.stdin.destroy();
					
					// Update basic values in package.json
					pkgFile.set('name', values.name);
					pkgFile.set('description', values.description);
					pkgFile.set('author', values.author);
					pkgFile.set('keywords', values.keywords.split(',').map(trim));
					pkgFile.writeSync();
					
					// Install dependencies
					var deps = values.dependencies.split(',').map(trim);
					command.open(pkgFile.root)
						.on('stdout', command.writeTo(process.stdout))
						.on('stderr', command.writeTo(process.stderr))
						.exec('npm', ['install', '--save'].concat(deps))
						.then(function() {
							// TODO Do we need to do anything here?
						});
				});
			}
		});
	});

// ------------------------------------------------------------------
//  $ nodes version [--increment [major|minor|patch|build]]

program
	.command('version')
	.description('Read or modify a project\'s version number')
	.option('-i, --increment [release]', 'Increment the given part of the version number')
	.action(function(options) {
		parseOptions();
		var project = scaffold.project(cwd);
		// Incrementing the version number
		if (option.increment) {
			var release = options.increment;
			if (release === true) {
				release = 'build';
			}
			var versions = project.incrementVersion(release);
			output.log('Version updated: ' + versions[0] + ' -> ' + versions[1]);
		}
		// Fetching the version number
		else {
			output.log(project.pkgFile.version());
		}
	});

// ------------------------------------------------------------------
//  $ nodes proc create <name> [-e foo,bar] [-g foo,bar]

program
	.command('proc create <name>')
	.description('Create a new proc')
	.option('-e, --local-events <events>', 'A comma delimited list of local events')
	.option('-g, --global-events <events>', 'A comma delimited list of global events')
		parseOptions();
		output.log.nolf('Creating process "' + procName + '"...');
		
		options.name = procName;
		options.localEvents = (options.localEvents || '').split(',');
		options.globalEvents = (options.globalEvents || '').split(',');
		
		scaffold.project(cwd).createProc(options, function(err) {
			if (err) {
				output.log('');
				throw err;
			}
			output.log(' Done.'.blue);
		});
	});

// ------------------------------------------------------------------
//  $ nodes proc destroy <name> [--force]

program
	.command('proc destroy <name>')
	.option('-f, --force', 'Do not ask for confirmation, just delete the files')
	.action(function(procName, options) {
		parseOptions();
		if (! options.force) {
			var prompt = 'Destroy the process "' + procName + '"? ';
			program.confirm(prompt, destroyProc);
		} else {
			destroyProc(true);
		}
		function destroyProc(ok) {
			if (ok) {
				output.log.nolf('Destroying process "' + procName + '"...');
				scaffold.project(cwd).destroyProc(procName, function(err) {
					if (err) {
						output.log('');
						throw err;
					}
					output.log(' Done.'.blue);
				});
			}
		}
	});

// ------------------------------------------------------------------
//  $ nodes proc disable <name>

program
	.command('proc disable <name>')
	.description('Disable a proc')
	.action(function(procName) {
		parseOptions();
		output.log.nolf('Disabling process "' + procName + '"...');
		scaffold.project(cwd).disableProc(procName, function(err) {
			if (err) {
				output.log('');
				throw err;
			}
			output.log(' Done.'.blue);
		});
	});

// ------------------------------------------------------------------
//  $ nodes proc enable <name>

program
	.command('proc enable <name>')
	.description('Enable a proc')
	.action(function(procName) {
		parseOptions();
		output.log.nolf('Enabling proc "' + procName + '"...');
		scaffold.project(cwd).enableProc(procName, function(err) {
			if (err) {
				output.log('');
				throw err;
			}
			output.log(' Done.'.blue);
		});
	});

// ------------------------------------------------------------------
//  $ nodes start [--output]

program
	.command('start')
	.description('Start the project procs')
	.option('-o, --output', 'If this is given, the app will run in the foreground and display output')
	.action(function(options) {
		parseOptions();
		start(scaffold.project(cwd), options);
	});

function start(project, options) {
	output.log.nolf('Starting the application...');
	project.start({output: options.output});
	if (options.output) {
		process.on('SIGINT', function() {
			output.log.nolf('Project shutting down...');
			project.stop(function() {
				output.log(' Good bye.');
				process.exit(0);
			});
		});
	}
	output.log((' Project running at PID ' + project.conf.pid + '.').blue);
}

// ------------------------------------------------------------------
//  $ nodes stop

program
	.command('stop')
	.description('Stop the project procs')
	.action(function() {
		parseOptions();
		stop(scaffold.project(cwd));
	});

function stop(project, callback) {
	output.log.nolf('Stopping the application...');
	project.stop(function(err) {
		if (err) {
			output.log('');
			throw err;
		}
		output.log(' Done.'.blue);
		if (callback) {
			callback();
		}
	});
}

// ------------------------------------------------------------------
//  $ nodes restart [--output]

program
	.command('restart')
	.description('Restart the project procs')
	.option('-o, --output', 'If this is given, the app will run in the foreground and display output')
	.action(function(options) {
		parseOptions();
		var project = scaffold.project(cwd);
		stop(project, function() {
			start(project, options);
		});
	});

// Go..
program.parse(process.argv);

// ------------------------------------------------------------------

function parseOptions() {
	output.conf.silent = program.quiet;
	output.conf.colors = program.color;
}

function slice(arr) {
	return Array.prototype.slice.call(arr);
}

function trim(str) {
	return str.trim();
}

