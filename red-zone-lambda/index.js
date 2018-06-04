'use strict';

/*
 * RED ZONE
 */

const moment = require("moment");
const AWS = require("aws-sdk");
AWS.config.update({region: "us-west-2"});

// TODO: After we implement multiple zone groups, they will be differentiated by "zone name" or "group name".
// Remember that these groups are NOT "users" because it could be just one user keeping track of several groups,
// for example "When is Alison's next Red Zone?" or "Is April 18th in Lori's Red Zone?".
const DEFAULT_ZONE_NAME = "default";
const DEFAULT_DURATION = 4;
const DEFAULT_INTERVAL = 28;

// --------------- Main Handler ------------------------------------------------

// Route the incoming request based on type (LaunchRequest, IntentRequest, etc.)
// The JSON body of the request is provided in the event parameter.
exports.handler = (event, context, callback) => {
	try {
		const userId = event.context.System.user.userId;
		const sessionId = event.session.sessionId;
		const requestId = event.request.requestId;
		const sessionAttributes = event.session.attributes;
		console.log(":: DAVELOG " + (new moment()).format("HH:mm:ss") + " UTC :: exports.handler(): userId=" + userId.slice(-10) + ", sessionId=" + sessionId.slice(-10) + ", requestId=" + requestId.slice(-10) + ", session.new=" + event.session.new + ", session.attributes.sessionId=" + (sessionAttributes ? sessionAttributes.sessionId : "not set"));
		
		if (event.session.new || !sessionAttributes || !sessionAttributes.sessionId) {
			onSessionStarted({ requestId: event.request.requestId }, event.session);
			// Load session and user data before continuing to part 2.
			loadSessionAttributes(event, callback);
		}
		else {
			// Session and user data has already been loaded into event.session.attributes so go directly to part 2.
			mainHandler2(event, sessionAttributes, callback);
		}
	}
	catch (err) {
		callback(err);
	}
};

// Part 2 of the main event handler, called after user data has been loaded from or inserted into the database.
// Called from loadUserCallback(), loadZonesCallback(), or addUserCallback().
function mainHandler2(event, sessionAttributes, callback) {
	try {
		const userId = sessionAttributes.userId;
		const sessionId = sessionAttributes.sessionId;
		const requestId = event.request.requestId;
		console.log(":: DAVELOG " + (new moment()).format("HH:mm:ss") + " UTC :: mainHandler2(): userId=" + userId.slice(-10) + ", sessionId=" + sessionId.slice(-10) + ", requestId=" + requestId.slice(-10) + ", session.new=" + event.session.new);
		
		switch (event.request.type) {
			case 'LaunchRequest':
				onLaunch(
					event.request,
					sessionAttributes,
					(sessionAttributes, speechletResponse) => {
						callback(null, buildResponse(sessionAttributes, speechletResponse));
				});
				break;
			case 'IntentRequest':
				onIntent(
					event.request,
					sessionAttributes,
					(sessionAttributes, speechletResponse) => {
						callback(null, buildResponse(sessionAttributes, speechletResponse));
				});
				break;
			case 'SessionEndedRequest':
				onSessionEnded(event.request, sessionAttributes);
				callback();
				break;
			default:
				console.log(":: DAVELOG " + (new moment()).format("HH:mm:ss") + " UTC :: mainHandler2(): unknown request type '" + event.request.type + "'");
				callback("Unknown request type '" + event.request.type + "'");
				break;
		}
	}
	catch (err) {
		callback(err);
	}
}

// --------------- Event Handlers ----------------------------------------------

/**
 * Called when a new session starts.
 */
function onSessionStarted(sessionStartedRequest, session) {
	const sessionId = session.sessionId;
	const requestId = sessionStartedRequest.requestId;
	console.log(":: DAVELOG " + (new moment()).format("HH:mm:ss") + " UTC :: onSessionStarted(): sessionId=" + sessionId.slice(-10) + ", requestId=" + requestId.slice(-10));
}

/**
 * Called when the user launches the skill without specifying what they want.
 */
function onLaunch(launchRequest, sessionAttributes, callback) {
	const userId = sessionAttributes.userId;
	const sessionId = sessionAttributes.sessionId;
	const requestId = launchRequest.requestId;
	console.log(":: DAVELOG " + (new moment()).format("HH:mm:ss") + " UTC :: onLaunch(): userId=" + userId.slice(-10) + ", sessionId=" + sessionId.slice(-10) + ", requestId=" + requestId.slice(-10));
	getWelcomeResponse(sessionAttributes, callback);
}

/**
 * Called when the user specifies an intent for this skill.
 */
function onIntent(intentRequest, sessionAttributes, callback) {
	
	const userId = sessionAttributes.userId;
	const sessionId = sessionAttributes.sessionId;
	const requestId = intentRequest.requestId;
	const intent = intentRequest.intent;
	const intentName = intentRequest.intent.name;
	console.log(":: DAVELOG " + (new moment()).format("HH:mm:ss") + " UTC :: onIntent(): userId=" + userId.slice(-10) + ", sessionId=" + sessionId.slice(-10) + ", requestId=" + requestId.slice(-10) + ', intentName=' + intentName + "'");
	
	// Dispatch to intent handlers
	// TODO: Add an intent to add (really just a rename from 'default') or change a user name.
	switch (intentName) {
		case 'AddZone':
			addZone(intent, sessionAttributes, intent.slots.BeginDate.value, intent.slots.EndDate.value, callback);
			break;
		case 'AddZoneByBeginDate':
			addZoneByBeginDate(intent, sessionAttributes, intent.slots.BeginDate.value, callback);
			break;
		case 'AddZoneByBeginDateAndDuration':
			addZoneByBeginDateAndDuration(intent, sessionAttributes, intent.slots.BeginDate.value, intent.slots.Duration.value, callback);
			break;
		case 'GetClosestZoneByDate':
			getClosestZoneByDate(intent, sessionAttributes, intent.slots.TargetDate.value, callback);
			break;
		case 'AMAZON.HelpIntent':
			// TODO: help message
			getWelcomeResponse(sessionAttributes, callback);
			break;
		case 'AMAZON.CancelIntent':
		case 'AMAZON.StopIntent':
			handleSessionEndRequest(callback);
			break;
		default:
			throw new Error('Invalid intent');
	}
}

/**
 * Called when the user ends the session.
 * Is NOT called when the skill returns shouldEndSession=true.
 */
function onSessionEnded(sessionEndedRequest, sessionAttributes) {
	const userId = sessionAttributes.userId;
	const sessionId = sessionAttributes.sessionId;
	const requestId = sessionEndedRequest.requestId;
	console.log(":: DAVELOG " + (new moment()).format("HH:mm:ss") + " UTC :: onSessionEnded(): userId=" + userId.slice(-10) + ", sessionId=" + sessionId.slice(-10) + ", requestId=" + requestId.slice(-10));

	// Add cleanup logic here
}

// --------------- Red Zone Functions ------------------------------------------

// Used by loadSessionAttributes(), loadUserCallback(), loadZonesCallback(), and addUser()
let allData = null;

// Populates an object with session info and everything we know about this user from previous sessions.
function loadSessionAttributes(event, callback) {
	try {
		const userId = event.context.System.user.userId;
		const sessionId = event.session.sessionId;
		const requestId = event.request.requestId;
		console.log(":: DAVELOG " + (new moment()).format("HH:mm:ss") + " UTC :: loadSessionAttributes(): userId=" + userId.slice(-10) + ", sessionId=" + sessionId.slice(-10) + ", requestId=" + requestId.slice(-10));
		
		// Save our params etc. to use in callback functions
		allData = {
			event: event,
			callback: callback,
			sessionAttributes: {
				sessionId: sessionId,
				userId: userId,
                // These are currently populated in addUserCallback() or loadUserCallback(),
				// but once we implement multiple zone groups they will be loaded from a separate table
				// since they are not one-to-one to userId.
				defaultDuration: null,
				defaultInterval: null,
				// This is populated in loadZonesCallback()
				userZones: null
			}
		};

		// Load user and zones in parallel and then continue with mainHandler2()
		retrieveUserFromDB(userId, loadUserCallback);
		retrieveZonesFromDB(userId, loadZonesCallback);
	}
	catch (err) {
		callback(err);
	}
}

// Called via callback param in retrieveUserFromDB()
let loadUserCallback = function(err, data) {
	if (err) {
		allData.callback(err);
		return;
	}

    const userId = allData.sessionAttributes.userId;
    const sessionId = allData.sessionAttributes.sessionId;
    console.log(":: DAVELOG " + (new moment()).format("HH:mm:ss") + " UTC :: loadUserCallback(): userId=" + userId.slice(-10) + ", sessionId=" + sessionId.slice(-10));

    if (data.Item) {
        console.log(":: DAVELOG " + (new moment()).format("HH:mm:ss") + " UTC :: loadUserCallback(): LOADED defaultDuration=" + data.Item.defaultDuration + " & defaultInterval=" + data.Item.defaultInterval);
        allData.sessionAttributes.defaultDuration = data.Item.defaultDuration;
        allData.sessionAttributes.defaultInterval = data.Item.defaultInterval;

        if (allData.sessionAttributes.userZones) {
            mainHandler2(allData.event, allData.sessionAttributes, allData.callback);
        }
    }
    else {
        addUser(userId, DEFAULT_ZONE_NAME, DEFAULT_DURATION, DEFAULT_INTERVAL);
    }
}

// Called via callback param in retrieveZonesFromDB()
let loadZonesCallback = function (err, data) {
	if (err) {
		allData.callback(err);
		return;
	}
	
	const userId = allData.sessionAttributes.userId;
	const sessionId = allData.sessionAttributes.sessionId;
    console.log(":: DAVELOG " + (new moment()).format("HH:mm:ss") + " UTC :: loadZonesCallback(): userId=" + userId.slice(-10) + ", sessionId=" + sessionId.slice(-10) + ", data.Items=" + JSON.stringify(data.Items));
	
	allData.sessionAttributes.userZones = data.Items || [];
	
	if (allData.sessionAttributes.defaultDuration) {
		mainHandler2(allData.event, allData.sessionAttributes, allData.callback);
	}
}

// Adds a new user, calling addUserCallback() when complete.
function addUser(userId, defaultDuration, defaultInterval) {
    console.log(":: DAVELOG " + (new moment()).format("HH:mm:ss") + " UTC :: addUser(): userId=" + userId.slice(-10) + ", defaultDuration=" + defaultDuration + ", defaultInterval=" + defaultInterval);

    allData.sessionAttributes.defaultDuration = defaultDuration;
    allData.sessionAttributes.defaultInterval = defaultInterval;
    allData.sessionAttributes.userZones = [];

    upsertUserInDB(allData.sessionAttributes, addUserCallback);
}

// Callback for addUser(), called via callback param in upsertUserInDB().
let addUserCallback = function (err, data) {
    if (err) {
        allData.callback(err);
        return;
    }

    // TODO: add more detail
    console.log(":: DAVELOG " + (new moment()).format("HH:mm:ss") + " UTC :: addUserCallback()"); //: userId=" + userId.slice(-10) + ", defaultDuration=" + defaultDuration + "', defaultInterval=" + defaultInterval);

    if (allData.sessionAttributes.userZones) {
        mainHandler2(allData.event, allData.sessionAttributes, allData.callback);
    }
}

// Used by addZone(), addZoneByBeginDate(), addZoneByBeginDateAndDuration(), addZoneCallback()
// TODO: name this something else like addZoneAttributes or better yet encapsulate within a class
let addZoneParams = null;

// Adds a zone by begin and end dates, calling addZoneCallback() when complete.
function addZone(intent, sessionAttributes, beginDateSlot, endDateSlot, callback) {
	
	const sessionId = sessionAttributes.sessionId;
	console.log(":: DAVELOG " + (new moment()).format("HH:mm:ss") + " UTC :: addZone(): sessionId=" + sessionId.slice(-10) + ", beginDateSlot='" + beginDateSlot + "', endDateSlot='" + endDateSlot + "'");

    // REGARDING DATES:
    // * When using the Service Simulator with terms like "today" it will return the UTC date of the region which may be different than the local date.
    // * We're not using amazon-date-parser here because weeks and other date ranges don't make sense when adding a zone.

	// TODO: do some checks here for example:
    // * Weeks, "weekend", and other date ranges don't make sense when adding a zone; explain to the user along with "Please try again" and end session
	// * End date must be after begin date; explain to the user along with "Please try again" and end session
	// * New zone can't overlap an existing zone; prompt the user whether to update the existing zone and continue as update if so, otherwise end session
	// * If duration seems out-of-the-ordinary then confirm with the user that's what they wanted
	// * If the begin date is in the future then confirm with the user that's what they wanted
	if (false) {
		const speechOutput = "TODO";
		const repromptText = null; // Setting repromptText to null signifies that we do not want to reprompt the user.
		const shouldEndSession = false; // or true if recoverable
		
		// If the user does not respond or says something that is not understood, the session will end.
		//callback(sessionAttributes, buildSpeechletResponse(intent.name, speechOutput, repromptText, shouldEndSession));
	}
	else if (false) {
		const speechOutput = "TODO";
		const repromptText = null; // Setting repromptText to null signifies that we do not want to reprompt the user.
		const shouldEndSession = false; // or true if recoverable
		
		// If the user does not respond or says something that is not understood, the session will end.
		//callback(sessionAttributes, buildSpeechletResponse(intent.name, speechOutput, repromptText, shouldEndSession));
	}
	else {
		// Valid dates
		// TODO: detect if we are updating an existing zone
		const isNew = true;
		// Save params and dates to use in the callback function
		addZoneParams = {
			intent: intent,
			sessionAttributes: sessionAttributes,
            beginDate: beginDateSlot,
            endDate: endDateSlot,
			isNew: isNew,
			callback: callback
		};
        upsertZoneInDB(sessionAttributes.userId, beginDateSlot, endDateSlot, addZoneCallback);
	}
}

function addZoneByBeginDate(intent, sessionAttributes, beginDateSlot, callback) {
	
	const sessionId = sessionAttributes.sessionId;
	console.log(":: DAVELOG " + (new moment()).format("HH:mm:ss") + " UTC :: addZoneByBeginDate(): sessionId=" + sessionId.slice(-10) + ", beginDateSlot='" + beginDateSlot + "'");

	let repromptText = null;
	let shouldEndSession = false;
	let speechOutput = '';
	
	const zoneLength = sessionAttributes.defaultDuration;
	
	// Calculate the new end date.
    // See date comments in addZone().
    const tempDate = new Date(beginDateSlot);
	tempDate.setDate(tempDate.getDate() + zoneLength);
	const endDateStr = dateFromDateTime(tempDate);
	
    console.log(":: DAVELOG " + (new moment()).format("HH:mm:ss") + " UTC :: addZoneByBeginDate(): endDateStr='" + endDateStr + "'");
	
    // TODO: do some checks here for example:
    // * Weeks, "weekend", and other date ranges don't make sense when adding a zone; explain to the user along with "Please try again" and end session
    // * New zone can't overlap an existing zone; prompt the user whether to update the existing zone and continue as update if so, otherwise end session
    // * If the begin date is in the future then confirm with the user that's what they wanted
    if (false) {
        const speechOutput = "TODO";
        const repromptText = null; // Setting repromptText to null signifies that we do not want to reprompt the user.
        const shouldEndSession = false; // or true if recoverable

        // If the user does not respond or says something that is not understood, the session will end.
        //callback(sessionAttributes, buildSpeechletResponse(intent.name, speechOutput, repromptText, shouldEndSession));
    }
    else if (false) {
        const speechOutput = "TODO";
        const repromptText = null; // Setting repromptText to null signifies that we do not want to reprompt the user.
        const shouldEndSession = false; // or true if recoverable

        // If the user does not respond or says something that is not understood, the session will end.
        //callback(sessionAttributes, buildSpeechletResponse(intent.name, speechOutput, repromptText, shouldEndSession));
    }
    else {
        // Valid date
        // TODO: detect if we are updating an existing zone
        const isNew = true;
        // Save params and dates to use in the callback function
        addZoneParams = {
            intent: intent,
            sessionAttributes: sessionAttributes,
            beginDate: beginDateSlot,
            endDate: endDateStr,
            isNew: isNew,
            callback: callback
        };
        upsertZoneInDB(sessionAttributes.userId, beginDateSlot, endDateStr, addZoneCallback);
    }
}

function addZoneByBeginDateAndDuration(intent, sessionAttributes, beginDateSlot, durationSlot, callback) {
	
	const sessionId = sessionAttributes.sessionId;
	console.log(":: DAVELOG " + (new moment()).format("HH:mm:ss") + " UTC :: addZoneByBeginDateAndDuration(): sessionId=" + sessionId.slice(-10) + ", beginDateSlot='" + beginDateSlot + "', durationSlot='" + durationSlot + "'");
	
	let repromptText = null;
	let shouldEndSession = false;
	let speechOutput = '';
	
	const zoneLength = parseInt(durationSlot);
	
	// Calculate the new end date.
    // See date comments in addZone().
	const tempDate = new Date(beginDateSlot);
	tempDate.setDate(tempDate.getDate() + zoneLength);
	const endDateStr = dateFromDateTime(tempDate);
	
	console.log(":: DAVELOG " + (new moment()).format("HH:mm:ss") + " UTC :: addZoneByBeginDateAndDuration(): endDateStr='" + endDateStr + "'");
	
    // TODO: do some checks here for example:
    // * Weeks, "weekend", and other date ranges don't make sense when adding a zone; explain to the user along with "Please try again" and end session
    // * New zone can't overlap an existing zone; prompt the user whether to update the existing zone and continue as update if so, otherwise end session
    // * If duration seems out-of-the-ordinary then confirm with the user that's what they wanted
    // * If the begin date is in the future then confirm with the user that's what they wanted
    if (false) {
        const speechOutput = "TODO";
        const repromptText = null; // Setting repromptText to null signifies that we do not want to reprompt the user.
        const shouldEndSession = false; // or true if recoverable

        // If the user does not respond or says something that is not understood, the session will end.
        //callback(sessionAttributes, buildSpeechletResponse(intent.name, speechOutput, repromptText, shouldEndSession));
    }
    else if (false) {
        const speechOutput = "TODO";
        const repromptText = null; // Setting repromptText to null signifies that we do not want to reprompt the user.
        const shouldEndSession = false; // or true if recoverable

        // If the user does not respond or says something that is not understood, the session will end.
        //callback(sessionAttributes, buildSpeechletResponse(intent.name, speechOutput, repromptText, shouldEndSession));
    }
    else {
        // Valid date and duration
        // TODO: detect if we are updating an existing zone
        const isNew = true;
        // Save params and dates to use in the callback function
        addZoneParams = {
            intent: intent,
            sessionAttributes: sessionAttributes,
            beginDate: beginDateSlot,
            endDate: endDateStr,
            isNew: isNew,
            callback: callback
        };
        upsertZoneInDB(sessionAttributes.userId, beginDateSlot, endDateStr, addZoneCallback);
    }
}

// Callback for all addZone*() functions, called via callback param in upsertZoneInDB().
let addZoneCallback = function(err, data) {
	if (err) {
		addZoneParams.callback(err);
		return;
	}
	
	// Calculate zone length
	const oneDay = 24*60*60*1000; // hours*minutes*seconds*milliseconds
	const firstDate = new Date(addZoneParams.beginDate);
	const secondDate = new Date(addZoneParams.endDate);
	const zoneLength = Math.round(Math.abs((firstDate.getTime() - secondDate.getTime()) / oneDay));
	
	// Build Alexa's response
	const fromDayDate = dayOfWeekFromDate(addZoneParams.beginDate) + " " + addZoneParams.beginDate;
	const toDayDate = dayOfWeekFromDate(addZoneParams.endDate) + " " + addZoneParams.endDate;
	let speechOutput;
	if (addZoneParams.isNew) {
		speechOutput = "You have added a new zone from " + fromDayDate + " to " + toDayDate + " which is a duration of " + zoneLength + " days";
	}
	else {
		speechOutput = "You have updated the " + fromDayDate + " zone to end " + toDayDate + " which now has a duration of " + zoneLength + " days";
	}
	const shouldEndSession = true;
	const repromptText = null; // setting repromptText to null signifies that we do not want to reprompt the user
	
	// Done
	addZoneParams.callback(addZoneParams.sessionAttributes, buildSpeechletResponse(addZoneParams.intent.name, speechOutput, repromptText, shouldEndSession));
}

function getClosestZoneByDate(intent, sessionAttributes, dateSlot, callback) {
	
	const sessionId = sessionAttributes.sessionId;
	console.log(":: DAVELOG " + (new moment()).format("HH:mm:ss") + " UTC :: getClosestZoneByDate(): sessionId=" + sessionId.slice(-10) + ", dateSlot='" + dateSlot + "'");
	
	const amazonDateParser = require('amazon-date-parser');
	let repromptText = null;
	let shouldEndSession = false;
	let speechOutput = '';
	
	// Get closest zone if any.
    // Note that when using the Service Simulator with terms like "today" it will return
    // the UTC date of the region which may be different than the local date.
	const targetDateRange = new amazonDateParser(dateSlot);
	const targetBeginDateStr = dateFromDateTime(targetDateRange.startDate);
	const targetEndDateStr = dateFromDateTime(targetDateRange.endDate);
	
	console.log(":: DAVELOG " + (new moment()).format("HH:mm:ss") + " UTC :: getClosestZoneByDate(): targetBeginDateStr='" + targetBeginDateStr + "', targetEndDateStr='" + targetEndDateStr + "'");
	
    //let randomDayOfMonth = getRandomInt(1, 28);
    //let zoneBeginDate = new Date(2011, 10, randomDayOfMonth);
    //speechOutput = "The random day is " + randomDayOfMonth;
    //speechOutput = "The random date is " + zoneBeginDate.toString(); // works but as GMT including time
	
	// Day and date
	speechOutput = "You asked about " + dayOfWeekFromDate(targetBeginDateStr) + " " + targetBeginDateStr;
	if (targetEndDateStr !== targetBeginDateStr) {
		speechOutput += " to " + dayOfWeekFromDate(targetEndDateStr) + " " + targetEndDateStr;
	}
	shouldEndSession = true;
	
    //let zoneEndDate = 
    //let zone = null;
    
//    if (zone) {
//        speechOutput = `The red zone begins Your favorite color is ${favoriteColor}. Goodbye.`;
//        shouldEndSession = true;
//    } else {
//        speechOutput = "";
//    }

	// Setting repromptText to null signifies that we do not want to reprompt the user.
	// If the user does not respond or says something that is not understood, the session will end.
	callback(sessionAttributes, buildSpeechletResponse(intent.name, speechOutput, repromptText, shouldEndSession));
}

/**
 * Red Zone was launched without a specific request.
 */
function getWelcomeResponse(sessionAttributes, callback) {

	const userId = sessionAttributes.userId;
	const sessionId = sessionAttributes.sessionId;
	console.log(":: DAVELOG " + (new moment()).format("HH:mm:ss") + " UTC :: getWelcomeResponse(): userId=" + userId.slice(-10) + ", sessionId=" + sessionId.slice(-10) + ", " + sessionAttributes.userZones.length + " user zones");

	const cardTitle = 'Welcome';
	let speechOutput = '';
	let repromptText = '';
    let shouldEndSession = true;

	// TODO: Most users will need only one zone, so don't default to asking for a name. Instead we'll use the
	// name 'default' by default and add and document an intent to add a new user which will rename 'default'
	// as part of the process.

	// TODO: After we add support for multiple zone groups, if there are multiple groups
	// on this account then remind the current user now to specify the "zone name" in their requests.

	if (sessionAttributes.userZones) {
		// TODO: Once we have mutiple zone groups implemented, this is only applicable if there is just one group
		speechOutput = 'Welcome to Red Zone, your next zone begins on ...'; // TODO
	}
	else {
		speechOutput = 'Welcome to Red Zone, when did your last red zone begin?';

	    // If the user either does not reply to the welcome message or says something that is not
    	// understood, they will be prompted again with this text.
		repromptText = 'You have no red zone dates yet, would you like to add one?';
		shouldEndSession = false;
	}

    callback(sessionAttributes, buildSpeechletResponse(cardTitle, speechOutput, repromptText, shouldEndSession));
}

function handleSessionEndRequest(callback) {
    const cardTitle = 'Session Ended';
    const speechOutput = 'Thank you for using Red Zone. Have a nice day!';
    const shouldEndSession = true;

    callback({}, buildSpeechletResponse(cardTitle, speechOutput, null, shouldEndSession));
}

// --------------- Database Functions ------------------------------------------

// TODO: move these database functions to another file and load using require().

function retrieveUserFromDB(userId, callback) {
	console.log(":: DAVELOG " + (new moment()).format("HH:mm:ss") + " UTC :: retrieveUserFromDB(): userId=" + userId.slice(-10));
	
	// TODO: userName will be removed from the redzone-user table
	const docClient = new AWS.DynamoDB.DocumentClient();
	const params = {
		TableName: "redzone-user",
		Key: {
			userId: userId,
			userName: DEFAULT_ZONE_NAME
		}
	};
    docClient.get(params, callback);
}

function retrieveZonesFromDB(userId, callback) {
	console.log(":: DAVELOG " + (new moment()).format("HH:mm:ss") + " UTC :: retrieveZonesFromDB(): userId=" + userId.slice(-10));
	
	// TODO: the redzone-zone table will use userId as its primary key just like redzone-user,
	// and in this function we want to load all zones from all groups that are associated with the userId,
	// which we can then filter by group as needed here on the client.
    const docClient = new AWS.DynamoDB.DocumentClient();
    const params = {
        TableName: "redzone-zone",
        KeyConditionExpression: 'userKey = :userKey AND beginDate > :beginningOfTime',
        ExpressionAttributeValues: {
            ':userKey': userId + "-" + DEFAULT_ZONE_NAME,
            ':beginningOfTime': '2000-01-01'
        }
    };
    docClient.query(params, callback);
}

// Inserts a new user into the database or updates an existing one if userId already exists.
function upsertUserInDB(sessionAttributes, callback) {
	const userId = sessionAttributes.userId;
	const sessionId = sessionAttributes.sessionId;
    console.log(":: DAVELOG " + (new moment()).format("HH:mm:ss") + " UTC :: upsertUserInDB(): userId=" + userId.slice(-10) + ", sessionId=" + sessionId.slice(-10) + ", defaultDuration=" + sessionAttributes.defaultDuration + ", defaultInterval=" + sessionAttributes.defaultInterval);
	
	// TODO: the userName column will be removed from the redzone-user table and replaced with "zoneName" in a new "zone group" table
	// that will have its own defaultDuration and defaultInterval columns.
    const docClient = new AWS.DynamoDB.DocumentClient();
    const params = {
        TableName: "redzone-user",
        Item: {
            userId: userId,
            userName: DEFAULT_ZONE_NAME,
            defaultDuration: sessionAttributes.defaultDuration,
            defaultInterval: sessionAttributes.defaultInterval,
            isActive: true
        }
    };
    // TODO: use docClient.update() if we're updating (or possibly for inserting too?)
    docClient.put(params, callback);
}

// Inserts a new zone into the database or updates an existing one if one already exists with the same begin date.
function upsertZoneInDB(userId, beginDate, endDate, callback) {
	console.log(":: DAVELOG " + (new moment()).format("HH:mm:ss") + " UTC :: upsertZoneInDB(): userId=" + userId.slice(-10) + ", beginDate='" + beginDate + "', endDate='" + endDate + "'");
	
	const docClient = new AWS.DynamoDB.DocumentClient();
	const params = {
		TableName: "redzone-zone",
		Item: {
			userKey: userId + "-" + DEFAULT_ZONE_NAME,
			beginDate: beginDate,
            endDate: endDate,
            isActive: true
		}
	};
    // TODO: use docClient.update() if we're updating
	docClient.put(params, callback);
}

// --------------- Helpers -----------------------------------------------------

function buildSpeechletResponse(title, output, repromptText, shouldEndSession) {
    return {
        outputSpeech: {
            type: 'PlainText',
            text: output,
        },
        card: {
            type: 'Simple',
            title: `SessionSpeechlet - ${title}`,
            content: `SessionSpeechlet - ${output}`,
        },
        reprompt: {
            outputSpeech: {
                type: 'PlainText',
                text: repromptText,
            },
        },
        shouldEndSession,
    };
}

function buildResponse(sessionAttributes, speechletResponse) {
    return {
        version: '1.0',
        sessionAttributes,
        response: speechletResponse,
    };
}

// Note that when using the Service Simulator with terms like "today" it will
// return the UTC date of the region which may be different than the local date.
function dateFromDateTime(dateTime) {
    //console.info(":: DAVELOG " + (new moment()).format("HH:mm:ss") + " UTC :: dateFromDateTime(): dateTime='" + dateTime + "'");
	if (dateTime instanceof Date) {
        //console.info(":: DAVELOG " + (new moment()).format("HH:mm:ss") + " UTC :: dateFromDateTime(): dateTime.toISOString().substring(0, 10)='" + dateTime.toISOString().substring(0, 10) + "'");
		return dateTime.toISOString().substring(0, 10);
	}
	return '';
}

// See header comment for dateFromDateTime()
function dayOfWeekFromDate(date) {
	const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
	let dateObj;
	if (date instanceof Date) {
		dateObj = date;
	}
	else {
		dateObj = new Date(date);
	}
	return dayNames[dateObj.getDay()];
}

/**
 * Returns a random integer between min (inclusive) and max (inclusive)
 * Using Math.round() will give you a non-uniform distribution!
 */
function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
