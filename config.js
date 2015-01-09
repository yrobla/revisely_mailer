/**
 * Config params
 * 20131209
 * 
 */
config = (function () {
	var config = function () {

	};
	
	config.dbparams = { user:'#MYSQL_USER#', password:'#MYSQL_PASSWORD#', database:'#MYSQL_DATABASE#', host:'#MYSQL_HOST#', port:'3306', multipleStatements:false, waitForConnections:true, connectionLimit: 2};
	
	config.fromemail = '#FROM_EMAIL#';
    	config.fromname = '#FROM_NAME#';
    	config.admin_email1 = '#ADMIN_EMAIL#';
    
    	config.email_servers = [
#EMAIL_SERVERS
]

    	config.email_threads = 10;
    	config.email_max_retries = 3;
    	config.email_retry_interval = 10000;    

	config.lang = 'en';
    
	return config;
})();

module.exports = config;

