
var common = (function () {
	var sprintf     = require('sprintf').sprintf;
	var request     = require('request');
	var querystring = require('querystring');
	var http        = require('http');
	var fs          = require('fs');
	var url         = require("url");
	var uuid        = require('node-uuid');
    var	crypto      = require('crypto');
    
	var common = function () {
		
		
	}
	
	common.isset = function (s) {
		try {
		   if (s==undefined || s=='undefined' || s=='' || s.length<=0) return false;
		   return true;
		} catch (e) {
		   return false;
		}
	}
	
	common.md5 = function (s) {
		var hash = crypto.createHash('md5').update(s).digest('hex');
		return hash;
	}

	
	common.uuid = function () {
		var n = uuid.v1({
			  node: [0x01, 0x23, 0x45, 0x67, 0x89, 0xab],
			  clockseq: 0x1234,
			  msecs: new Date().getTime(),
			  nsecs: 5678
			});
	    return n;
	}

	
	common.rand = function (from, to) {
		var n = Math.floor(Math.random() * to) + from;
		return n;
	}
	
	common.strip_tags = function (s) {
		s=s+'';
		return s.replace(/<(?:.|\n)*?>/gm, '');
	}
	
	return common;
})();


module.exports = common;

