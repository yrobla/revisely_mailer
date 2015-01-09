var mysql         = require('mysql');             // mysql library
var common        = require('common.js');   // common functions 
var config        = require('config.js');   // config application
var util          = require('util');
var fs            = require('fs');
var nodemailer    = require("nodemailer");
var smtpTransport = require('nodemailer-smtp-transport');
var Syslog        = require("node-syslog");
var async         = require("async");

/**
 * @class EmailQueue
 * @brief Manage the email sendings trought a queue 
 * 
 * @parm retry Flag to indicate if we should call periodically to load or not
 * 
 * 2014627 observations:
 * Hemos de escribir también en la tabla de sistema de log. El administrador general
 * no mirará la tabla de user_log, ésta solo está destinada al profesor. Por tanto
 * necesitamos saber también qué está pasando. (Y para mostrarlo después en el dashboard de backoffice).
 * 
 * Eventos para la tabla general de log:
 *  - Cuando el sistema arranca (Esto se hace con upstart, el script está en /etc/init/beta_email_revisely.conf para beta y
 *  /etc/init/dev_email_revisely.conf para dev. El tipo será "info"
 *  - Cuando se produce un envío erróneo (al igual que en user_log). El tipo será "warning"  
 *  - Cuando cambiamos de servicio de correo. El tipo será "warning"
 *  - Si se para inesperadamente. El tipo será "error". Este punto requerirá una intervenció manual para arrancarlo de nuevo. 
 *    (Posteriormente mirando el log, podemos lanzar una alerta al movil, etc cuando entre un log de tipo error).
 *    
 * Además de que el script envíe correctamente, hemos de asegurarnos de que no consume más hilos/descriptores que los
 * que el sistema operativo soporte.     
 *  
 */
function EmailQueue (retry) {
	if (retry == undefined) this.retry = true;
	else this.retry = retry;
	this.dbconn      = false;
	this.isdb        = false;
	this.debug       = true;
	this.max_threads = config.email_threads;  // max num of threads for email queue .. 
	this.current_threads = 0;
	var self=this;

	Syslog.init("node-syslog", Syslog.LOG_PID | Syslog.LOG_ODELAY, Syslog.LOG_LOCAL0);
	Syslog.log(Syslog.LOG_INFO, 'Process: '+process.pid+' - Starting execution');

	if (__dirname.indexOf("dev.revise.ly")>-1) {
		var type = "info";
	} else {
		var type = "warning";
	}
	this.log_app(type, 'Starting email service');
	
	if (this.retry) {
		setInterval (function() {
			self.load();
		}, config.email_retry_interval);
	}
}

EmailQueue.prototype.connect = function () {
	if (!this.isdb) {
		this.dbconn = mysql.createPool (config.dbparams);
		this.isdb=true;
	}
}

EmailQueue.prototype.close = function () {
	var self=this;	
	Syslog.close();
}

function addslashes(str){
	str = str.replace(/\\/g,'\\\\');
	str = str.replace(/\'/g,'\\\'');
	str = str.replace(/\"/g,'\\"');
	str = str.replace(/\0/g,'\\0');
	return str;
}

/**
* Logs user error
* @param user_id 
* @param error  
* change user_alerts by user_log 
*/
EmailQueue.prototype.log_error = function (user_id, error) {
	var self = this;
	self.connect();

	if (error.name) var current_error = error.name+": "+error.data;
	else var current_error = error;
	var q = "INSERT INTO user_alerts (user_id, alert_type, alert_message, alert_date) "+
	     	"VALUES ('"+user_id+"', 'EMAIL', "+this.dbconn.escape(addslashes(current_error))+", NOW())";

    	var conn = this.dbconn;
       	conn.query(q);

	return true;
}

/**
* Logs app entries
* @param message
* @param type
*/
EmailQueue.prototype.log_app = function (type, message) {
	var self = this;
	self.connect();

	message = addslashes(message);
	message = this.dbconn.escape(message);

	var q = "INSERT INTO log (registered, log_type, log, log_meta) values (NOW(), '"+type+"', "+message+", '')";
    	var conn = this.dbconn;
       	conn.query(q);
	return true;
}


/**
*  Given mail settings, creates a transport and returns it
 */
EmailQueue.prototype.get_mailer = function(settings) {
	/*
	var mailt = nodemailer.createTransport("SMTP", {
        	host: settings.hostsmtp, // hostname
        	secureConnection: false, // use SSL
        	port: 25, // port for secure SMTP
        	auth: {
          		user: settings.usersmtp,
          		pass: settings.passsmtp
        	}
    	});
    */
	var mailt = nodemailer.createTransport(smtpTransport({
		service: 'SMTP',
    	host: settings.hostsmtp, // hostname
    	secureConnection: false, // use SSL
    	port: 25, // port for secure SMTP
    	auth: {
      		user: settings.usersmtp,
      		pass: settings.passsmtp
    	}
	}));
	return mailt;
}


/** 
 * Given a register and an index to the list of transports that we can use,
 * it sends an email with the given settings. So we are able to send an
 * email with different email providers as needed 
 */
EmailQueue.prototype.send_with_transport = function(register, current_server) {
	var self = this;

	var current_transport = self.get_mailer(config.email_servers[current_server]);
	if (current_server>0) {
		var m = 'Changing email service provider to '+config.email_servers[current_server]['hostsmtp'];
		self.log_app('warning', m);
		if (self.debug) console.log (m);
	}

	self.send (current_transport, register, function (_e,_r) {
		current_transport.close();
		if (!_e) {
			self.del (_r.status.id, function (_e,_r) { });
			return (true, _e, _r);
		} else {
			var current_item = current_server+1;
			if (current_item<config.email_servers.length) {
				// retry with next email provider
				self.send_with_transport(register, current_item);
			} else {
				/* If we have overpassed the max retries limit, we just delete the entry.
                                 * If not, we increase the max tries and retry */
				if (_r.status.tries>=config.email_max_retries) {
					self.del (_r.status.id, function (_e,_r) { });
				} else {
					self.add_tries (_r.status.id, function (_e,_r) { });
				}
				self.log_error(_r.status.user_id, _e.data);
				self.log_app('warning', _e.data);
				if (self.debug) console.log (_e.data);

				return (false, _e, _r);
			}
		}
	});
}


/**
 * @private function 
 * @param reg current register to be processed
 * @param callback function when the tasks is finished
 */
EmailQueue.prototype.send_index = function (register, cb) {
	var self=this;
	var limit = config.email_servers.length;

	/* We always send email with first server. If that fails we alternate
     * for the list of all the available servers. If that fails then we mark
     * the entry for a retry */
	result = self.send_with_transport(register, 0);
}



/**
 * Load a schreduled tasks for sending email queue
 */
EmailQueue.prototype.load = function () {
	Syslog.init("node-syslog", Syslog.LOG_PID | Syslog.LOG_ODELAY, Syslog.LOG_LOCAL0);

	var self=this;
	if (this.current_threads>=this.max_threads) { return false; }
	self.connect();
	
    /**
      * We check for lost connections on each interval. load() call is retried periodically
      * as defined on setInterval. So we do a check each time load() is called. That is
      * only caring for alerts that may have remained as in_process stage for 3 hours. That
      * means a bug or abnormal termination of server, so it shouldn't happen. 
      */
    var q = "DELETE FROM alerts WHERE in_process=1 AND process_started<NOW() - INTERVAL 3 HOUR";
	self.dbconn.query(q);

	self.next (function (e,r) {
		var ml = r.length;
		if (ml<=0) {
			self.close();
			return;
		}
		var ci = 0;

		for (var i=0;i<ml;i++) {
			this.current_threads++;
			var current_reg = r[i];		
			self.send_index (current_reg, function (e,r) {
				self.current_threads--;
	       		self.close();
			 });
		}
	});
}


/**
 * Read next database entries
 * @param cb callback function 
 */
EmailQueue.prototype.next = function (cb) {
	var self=this;
	this.connect();
	var _q = '';
	var _i = '';

	/* limit: num_threads contains the number of children that are still in use
     * in the execution. If for some reason, the next() call is called when there are
     * still threads from the prev execution in use, it will grab less data in that
     * round to conform to the max_threads limit specified */
	var limit = parseInt(self.max_threads) - parseInt(self.current_threads);

	var q = "SELECT * FROM alerts WHERE in_process=0 ORDER BY id ASC LIMIT 0,"+limit+" FOR UPDATE";

	/* async used because if not, execution was returned before all the locks had been set,
     * so it couldn't process properly the rows in use. Using async we ensure that execution
     * flow is properly handled. */
	self.dbconn.query(q, function(e, result) {
		for (var i=0;i<result.length;i++) {
			var sqlResult = result[i];
			// update and set as in_process
			//self.dbconn.query("UPDATE alerts SET in_process=1, process_started=NOW() WHERE id='"+sqlResult.id+"'");
		}
		var results = cb(e, result);
		return results;
	});
}

/**
 * Delete a email entry
 * @param id email unique identifier
 * @param cb callback function 
 */
EmailQueue.prototype.del = function (id, cb) {
	var self=this;
	self.connect();

	var q = "delete from alerts where id = '"+id+"' ";
	self.dbconn.query(q);

	return true;
}


/**
 * Add a tries index when the email is unable to send
 * @param id email uique identifier 
 * @param cb callback function
 */
EmailQueue.prototype.add_tries = function (id, cb) {
	var self=this;
	self.connect();

	/* we can establish a max number of connections available. Now it's set to 10
     * It can be useful also in the future, if we choose a clustered mysql, we can define
     * a clustered pool here. We increase the tries and set in_process to 0 so it gets grabbed
     * again when retrying next() function. */
	self.dbconn.query("UPDATE alerts SET in_process=0, tries=tries+1, process_started=NULL, `updated`=NOW() WHERE id='"+id+"'");
}


/**
 * Action to send email 
 * @param mailt mail transport object
 * @param m data object
 * @param cb callback function 
 */
EmailQueue.prototype.send = function (mailt, m, cb) {
	// m.toemail = 'victor@limogin.com';
	var self=this;
	
	var options = {
		    from: config.fromemail, // sender address
		    to: m.toemail, // list of receivers
		    subject: m.subject, // Subject line
		    text: '', // plaintext body
		    html: m.content // html body
	};
	
	mailt.sendMail(options, function (e,r) {
	    if (e) {
		 /* log error, to syslog and to user. We only write an entry in
          * user log if after all the retries, we still cannot send the
          * email to the user. Just before deleting the alert row */
		Syslog.init("node-syslog", Syslog.LOG_PID | Syslog.LOG_ODELAY, Syslog.LOG_LOCAL0);
		Syslog.log(Syslog.LOG_ERR, 'Process: '+process.pid+' - Error sending email: '+e);
	    } else {
	     if (self.debug) { 
	    	 console.log("Message sent: ");
	    	 console.log(r);
	     }
	     
	    }
         return cb (e, {status:m, result:r});
	     //smtpTransport.close(); // shut down the connection pool, no more messages
	});
	
}

function exitHandler(options, err) {
	if (options.exit) {
		// log to syslog
		Syslog.init("node-syslog", Syslog.LOG_PID | Syslog.LOG_ODELAY, Syslog.LOG_LOCAL0);
 		Syslog.log(Syslog.LOG_ERROR, 'Process: '+process.pid+' - Stopped abnormally');
		process.exit();
	}
}

// do something when app is closing
process.on('exit', exitHandler.bind(null,{cleanup:true}));

// catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {exit:true}));

// catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, {exit:true}));

function main() {
	var ec = new EmailQueue();
	ec.load();
}

if (require.main == module) {
	main();
}
module.exports = EmailQueue;
