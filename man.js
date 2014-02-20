#!/usr/bin/env node
var fs = require('fs');
var repl = require('repl');
var path = require('path');
var domain = require('domain');
var cp = require('child_process');

// https://www.npmjs.org/package/node-schedule
var schedule = require('node-schedule');
var colors = require('colors');

var conf = require('./cmd.json');

var _schedules = [];

var cmd = function(command, path, fn) {
	
	var cmd = cp.spawn('cmd', ['/c', command], {
		cwd: path,
		env: process.env,
		stdio: 'inherit'
	});
	cmd.on('close', fn);
	cmd.on('error', function (err) {
  		console.log(err);
	});
	return cmd;
};

var compile = function(directory) {
	cmd('mvn clean install', path.join(process.cwd(), directory), function(err) {
		if(err) {
			console.log(err);
		}
	});
};

var man = function() {
	console.log('run', '				', 'run main task'.grey);
	console.log('schedulers', '			', 'show scheduled tasks'.grey);
	console.log('<task>', '				', 'run'.grey, '<task>'.magenta);
	console.log('man', '				', 'show this help'.grey);
};

var run = function(task) {	
	console.log('Run'.grey, task);
	_run(conf.tasks[task]);
};

var runMain = function() {
	run(conf.main.task);
};

var schedulers = function() {
	_schedules.forEach(function(scheduler) {
		console.log(scheduler.name.grey, scheduler.nextInvocation().toString());
	});
};

var _run = function(queue) {

	if(!queue || queue.length == 0) {
		return;
	}

	var command = queue[0];
	cmd(command.cmd, path.join(process.cwd(), command.cwd), function(err) {
		if(err) {
			console.log(err);
		}
		if(!err || command.required == false) {
			setTimeout(function() {
				_run(queue.slice(1));
			}, 0);
		}
	});

};

var execute = function(fn) {
	var d = domain.create();
	d.run(fn);
	d.on('error', function(err) {
		console.log(err.message.red);
	});
	return 'done!';
};

if(conf.main.autorun == true) {
	run(conf.main.task);
}

console.log('Welcome !'.grey);
man();

var prompt = repl.start({
	prompt: ':>'
});

prompt.on('exit', function() {
	console.log('see ya !'.red);
	process.exit();
});


prompt.context.__defineGetter__('run', function() {
	return execute(runMain);
});
prompt.context.__defineGetter__('exit', function() {
	prompt.emit('exit');
});
prompt.context.__defineGetter__('schedulers', function() {
	return execute(schedulers);
});
prompt.context.__defineGetter__('man', function() {
	return execute(man);
});

Object.keys(conf.tasks).forEach(function(id) {
	prompt.context.__defineGetter__(id, function() {
		return execute(function() {
			run(id);
		});
	});
});

// Specified task to run at launch
var task = process.argv[2];
if(task) {
	run(task);
}

if(conf.schedulers) {
	
	conf.schedulers.forEach(function(scheduler) {
		_schedules.push(schedule.scheduleJob(scheduler.cron, function() {
			run(scheduler.task);
		}));
	});

}