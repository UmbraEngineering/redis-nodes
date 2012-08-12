
/**
 * This function is called at the very beginning of every process. It is used to
 * run code which must execute for all of the processes. The `proc` argument given
 * is the name of the process.
 */
module.exports = function(proc) {
	
	//
	// Do not remove this call.
	// 
	// This initializes the redis-nodes system (open redis connections, starts
	// event listeners, loads config, etc.)
	//
	require('redis-nodes').bootstrap(proc);
	
// ------------------------------------------------------------------
	
	//
	// Do whatever you want down here. This is space for you to make whatever
	// init calls your application needs.
	//
	
};

