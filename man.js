#!/usr/bin/env node
var fs = require('fs');
var repl = require('repl');
var path = require('path');
var domain = require('domain');
var cp = require('child_process');

// https://www.npmjs.org/package/node-schedule
var schedule = require('node-schedule');
//https://github.com/marak/colors.js/
var colors = require('colors');
//https://github.com/andris9/Nodemailer
var mailer	= require('nodemailer');
//https://github.com/ashtuchkin/iconv-lite
var iconv 	= require('iconv-lite');

var conf = require('./cmd.json');

var _schedules = [];
var _transports = {};


var sendMail = function(options, fn) {
	if(_emailer) {
		fn = fn || function() {};
		options.from = options.from || (conf.config.emailer.from || 'Node http server');
		_emailer.sendMail(options, function(err, response) {
			if(err) {
				server.echo(err.message.red);
			}
			fn(err, response);
		});
	} else {
		server.echo('# No transport configured'.red);
	}
};

var Transport = function(name, conf, transport) {
	this.name = name;
	this.conf = conf;
	this.transport = transport;
};

var Job = function(repl) {
	var MAX_BUFFER_CHARS = 5000;
	this.repl = repl;
	this.buffer = null;
	var self = this;
	this.repl.stdout.setEncoding('utf8');
	this.repl.stdout.on('data', function(data) {
		if(data) {
			var dataString = iconv.encode(iconv.decode(data, 'utf8'), 'iso88591');
			process.stdout.write(dataString);
			self.buffer += dataString;
			self.buffer = self.buffer.substr(Math.max(self.buffer.length - MAX_BUFFER_CHARS, 0), self.buffer.length - 1);
		}
	});

};


var createTransport = function(name, conf) {
	// Prepare emailer
	if(conf.type = "mailer") {
		var mailerTransport = mailer.createTransport("SMTP", conf.config);
		var transport = new Transport(name, conf, mailerTransport);

		transport.send = function(code, data, options) {
		
			this.transport.sendMail({ 
				from: options.from || this.conf.from,
				to: options.to || this.conf.to,
				subject: options.subject,
				text: 'Job finished with code:' + code + '\n\n' + data
			}, function(err, response) {
				if(err) {
					console.log(err.message.red);
				} else {
					console.log(response.message.grey);
				}
			});
		};
		return transport;
	} else {
		console.log("Unknow transport type", conf.type.red);
	}
}

var cmd = function(command, path, fn) {
	
	var shell = '/bin/sh';
	var args = ['-c'];
	if(process.platform == 'win32') {
		shell = 'cmd';
		args = ['/U', '/c'];
	}

	args.push(command);

	var cmd = cp.spawn(shell, args, {
		cwd: path,
		env: process.env
	});

	var job = new Job(cmd);

	cmd.on('close', function() {
		fn.apply(job, arguments);
	});

	cmd.on('error', function (err) {
  		console.log(err);
	});

	return job;
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
		console.log('END QUEUE'.green);
		return;
	}

	var command = queue[0];
	cmd(command.cmd, path.resolve(command.cwd || ''), function(code, signal) {
		if(code) {
			console.log(code);
		}
		if(command.transport) {
			var t = _transports[command.transport.id];
			if(t) {
				t.send(code, this.buffer, command.transport);
			} else {
				console.log('Unknow transport', command.transport.id.red);
			}
		}
		if(!code || command.required == false) {
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
};


if(conf && conf.config && conf.config.transports) {
	Object.keys(conf.config.transports).forEach(function(name)  {
		_transports[name] = createTransport(name, conf.config.transports[name]);
	});
}

console.log('Welcome !'.grey);
man();

var prompt = repl.start({
	prompt: ':>',
	ignoreUndefined : true
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
		_schedules.push(schedule.scheduleJob(scheduler.name, scheduler.cron, function() {
			run(scheduler.task);
		}));
	});

}

if(conf.main.autorun == true) {
	run(conf.main.task);
}