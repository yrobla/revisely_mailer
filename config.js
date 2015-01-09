/**
 * Config params
 * 20131209
 * 
 */
config = (function () {
	var config = function () {

	};
	
	config.dbparams = { user:'', password:'', database:'', host:'', port:'3306', multipleStatements:false, waitForConnections:true, connectionLimit: 2};
	
	config.fromemail = '';
    	config.fromname = '';
    	config.admin_email1 = '';
    
    	config.email_servers = []

    	config.email_threads = 10;
    	config.email_max_retries = 3;
    	config.email_retry_interval = 10000;    

	config.lang = 'en';
    
	return config;
})();

module.exports = config;

