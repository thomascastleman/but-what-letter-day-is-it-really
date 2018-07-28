
var express         = require('express');
var mustacheExpress = require('mustache-express');
var bodyParser      = require('body-parser');
var moment			= require('moment');
var cal 			= require('ical');
var fs				= require('fs');
var creds			= require('./credentials.js');

var app = express();
app.use(bodyParser.json());
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

// get today's letter and rotation info
app.get('/letterToday', function(req, res) {
	getLetterDayByDate(moment(), function(data) {
		res.send(data);
	});
});

// get letter / rotation info for a given date
app.post('/letterByDate', function(req, res) {
	if (req.body.date) {
		var d = moment(req.body.date);
		getLetterDayByDate(d, function(data) {
			res.send(data);
		});
	} else {
		res.send(undefined);
	}
});

// get all possible schedule info for a given weekday date
app.post('/infoByDate', function(req, res) {
	if (req.body.date) {
		var d = moment(req.body.date).startOf('day');
		if (d) {
			// start constructing all info for given day
			var dayInfo = {
				schedule: []
			};

			// get schedule skeleton for this weekday
			var tempSched = schedule.weekDays[d.weekday()];

			// if schedule exists for this day
			if (tempSched) {
				// attempt to get letter day info for this day
				getLetterDayByDate(d, function(data) {
					// record letter data in response object
					if (data) {
						dayInfo.letter = data.letter;
						dayInfo.rotation = data.rotation;
					}

					var r = 0;

					// for each event in the schedule that day
					for (var i = 0; i < tempSched.length; i++) {
						var ev = tempSched[i];

						// if class period, attempt to classify using rotation
						if (ev.block && dayInfo.rotation && ev.block > 0) {
							ev.period = dayInfo.rotation[ev.block - 1];
						}

						// convert event times relative to requested date
						ev.start = d.clone().add(ev.start, 'minutes').format('YYYY-MM-DD hh:mm A');
						ev.end = d.clone().add(ev.end, 'minutes').format('YYYY-MM-DD hh:mm A');

						// prevent extended blocks for non-extended periods from getting added to day's schedule
						if (!ev.isExtended || schedule.extendedPeriods.indexOf(parseInt(ev.period, 10)) != -1) {
							dayInfo.schedule.push(ev);
						}
					}

					res.send(dayInfo);
				});
			} else {
				res.send(undefined);
			}
		} else {
			res.send(undefined);
		}
	} else {
		res.send(undefined);
	}
});