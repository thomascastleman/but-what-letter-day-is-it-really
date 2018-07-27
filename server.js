
var express         = require('express');
var mustacheExpress = require('mustache-express');
var bodyParser      = require('body-parser');
var moment			= require('moment');
var cal 			= require('ical');
var fs				= require('fs');
var creds			= require('./credentials.js');

var app = express();
app.use(bodyParser.urlencoded({extended: false}));
app.engine('html', mustacheExpress());
app.use('/', express.static('views'));

var schedule;

fs.readFile('testschedule.json', 'UTF8', function(err, data) {
	if (err) throw err; 	// temp debug
	schedule = JSON.parse(data);

	var server = app.listen(8080, function() {
		console.log('Letter Day server listening on port %d', server.address().port);
	});
});

// given moment date, determine letter day and class rotation for that day, if any
function getLetterDayByDate(date, callback) {
	// call veracross API
	cal.fromURL(creds.schoolEventsCalendar, {}, function(err, data) {
		if (err) throw err;	// temp, debug

		var isLetterDay = /([ABCDEF])\s\(US\)\s(\d)-(\d)-(\d)/g;
		var letter, rotation;

		// iterate over events
		for (var k in data) {
			if (data.hasOwnProperty(k)) {
				var ev = data[k];

				var match = isLetterDay.exec(ev.summary);

				// if contains info indicating upper school letter day
				if (match) {
					var evDate = moment(ev.start);

					// if event date same as target date
					if (evDate.isSame(date, 'day')) {
						// extract regex match data
						letter = match[1];
						rotation = [match[2], match[3], match[4]];
						break;
					}
				}
			}
		}

		// callback on resulting data
		if (letter && rotation) {
			callback({
				letter: letter,
				rotation: rotation
			});
		} else {
			callback(undefined);
		}
	});
}

// get today's letter and rotation
app.get('/letterToday', function(req, res) {
	getLetterDayByDate(moment(), function(data) {
		res.send(data);
	});
});