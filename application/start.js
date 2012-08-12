/**
 * Application init script
 */

// Make sure we are always running in the right directory.
// This has to be called before the redis-nodes module is loaded.
process.chdir(__dirname);

// ------------------------------------------------------------------

var nodes = require('redis-nodes');

// Read the state file
var state = nodes.state.readSync();

// Write the pid to the state file
state.pids._start = process.pid;
nodes.state.write(state, throws);

// Read through the procs list and start up the processes
var procs = { };
state.procs.forEach(function(proc) {
	procs[proc] = new nodes.Spawner(proc);
});

// When this process is told to shutdown, stop all the procs
process.on('SIGTERM', function() {
	var keys = Object.keys(procs);
	keys.forEach(function(key) {
		var proc = procs[key];
		proc.stop();
		proc.kill(function() {
			console.log(key + ' proc shutdown');
			
			// Remove one from the list and check if there are more left
			keys.pop();
			if (! keys.length) {
				console.log('Shutting down.');
				process.exit(0);
			}
		});
	});
});

// ------------------------------------------------------------------

function throws(err) {
	if (err) {
		throw err;
	}
}


