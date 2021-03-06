const resolver = require('../resolver');
const mongo = require('../mongo');
const q = require('q');
const messages = require('../schemas/messages.json');
const validator = require('../validator');
const colors = require('colors');
const bot = require('../bot');
const alerts = require('../alerts');
const moment = require('moment');

const utils = require('./utils');

function getMessages(req) {
    const timeBasedQueries = {
        today: {
            from: new Date().toJSON().slice(0,10),
            to: new Date().toJSON()
        },
        weekToDate: {
            from: moment(moment().startOf('week')).format('YYYY-MM-DD'),
            to: new Date().toJSON()
        },
        monthToDate: {
            from: moment(moment().startOf('month')).format('YYYY-MM-DD'),
            to: new Date().toJSON()
        },
        yearToDate: {
            from: moment(moment().startOf('year')).format('YYYY-MM-DD'),
            to: new Date().toJSON()
        },
        yesterday: {
            from: moment(moment().subtract(1, 'days').startOf('day')).format('YYYY-MM-DD'),
            to: moment(moment().subtract(0, 'days').startOf('day')).format('YYYY-MM-DD')
        },
        previousWeek: {
            from: moment(moment().subtract(1, 'weeks').startOf('isoWeek')).format('YYYY-MM-DD'),
            to: moment(moment().subtract(1, 'weeks').endOf('isoWeek')).format('YYYY-MM-DD')
        },
        previousMonth: {
            from: moment(moment().subtract(1, 'months').startOf('month')).format('YYYY-MM-DD'),
            to: moment(moment().subtract(1, 'months').endOf('month')).format('YYYY-MM-DD')
        },
        previousYear: {
            from: moment(moment().subtract(1, 'year').startOf('year')).format('YYYY-MM-DD'),
            to: moment(moment().subtract(1, 'year').endOf('year')).format('YYYY-MM-DD')
        },
        last15Minutes: {
            from: moment(moment().subtract(15, 'minutes')),
            to: new Date().toJSON()
        },
        last60Minutes: {
            from: moment(moment().subtract(60, 'minutes')),
            to: new Date().toJSON()
        },
        last4Hours: {
            from: moment(moment().subtract(4, 'hours')),
            to: new Date().toJSON()
        },
        last24Hours: {
            from: moment(moment().subtract(24, 'hours')),
            to: new Date().toJSON()
        },
        last7Days: {
            from: moment(moment().subtract(7, 'days')),
            to: new Date().toJSON()
        },
        last30Days: {
            from: moment(moment().subtract(30, 'days')),
            to: new Date().toJSON()
        }
    };

  const deferred = q.defer();

  let sort = {uid: 1};
  let filter = '';

  // DB aggregate projection
  const projection = {
    _id: '$queueGroup',
    message: {$last: '$message'},
    queueType: {$last: '$queueType'},
    time: {$last: '$time'},
    sender: {$last: '$sender'},
    queueGroup: {$last: '$queueGroup'},
    uid: {$last: '$uid'}
  };

  // Used for time based filtering
  const match = {
      $match: {time: { $gte: new Date('2017-01-01'), $lte: new Date() }}
  };

  // Set time based filter
    if (req.query.filter) {
        match['$match']['time']['$gte'] = new Date(timeBasedQueries[req.query.filter].from);
        match['$match']['time']['$lte'] = new Date(timeBasedQueries[req.query.filter].to);
    }

  // Set search filter
  if (req.query.search) {
    filter = req.query.search;
  }

  resolver.aggregate(req, 'messages', sort, projection, filter, match).then(messages => {
    mongo.find({}, 'queueGroups', function(queueGroups) {
      messages.items.map(message => { // Enhance each message with number of subscribers
        message.responseFrom = [];
        queueGroups.map(queue => { // Map trough queues to attach subscribers to response and attach whoever replied
          if (message.queueGroup == queue.queueGroup) {
            message.subscribers = queue.subscribers;
            queue.responseFrom.map(replied => { // Attach whoever replied
              if (message.responseFrom.indexOf(replied) == -1 ) {
                message.responseFrom.push(replied);
              }
            })
          }
        })
      });

      deferred.resolve(messages);
    });
  });

  return deferred.promise;
}

// Save message received from the bot
function save(req) {
  console.log('calling save ', req.body);
  const deferred = q.defer();
  const v = validator.isValid(req, messages.message);
  let hasAlert;

  if (v) {
    deferred.reject({status: 400, message: v});
  } else {
    let time = new Date();
    let messageObj = {
      sender: req.body.number,
      message: req.body.message,
      time,
      uid: time.getTime()
    };

    // Check alert criteria and perform an action if required
    // Get queue type
      let queueType = req.body.message.substr(0, req.body.message.indexOf(' '));
      if (req.body.queueGroup) {
          queueType = req.body.queueGroup.split('_')[0];
      }
    alerts.checkAlerts(queueType).then(alertsRes => {
      // There is an alert
      if (alertsRes.hasAlert) {
          alertsRes.alerts.map(alert => {
            // If type of alert is not on message received
            if (alert.typeCriteria !== '2') {
                return false;
            }
            // Check if alert should be triggered based on hours time span
            if (!alerts.shouldTriggerAlert(parseInt(alert.timeHourStart, 10), parseInt(alert.timeHourStop, 10), new Date().getHours())) {
                return false;
            }
            // Check if alert should be triggered based on days of the week time span
            if (!alerts.shouldTriggerAlert(parseInt(alert.dayOfWeekFrom, 10), parseInt(alert.dayOfWeekTo, 10), new Date().getDay())) {
                return false;
            }

            // Mark message has alert
            hasAlert = {
                message: 'Queue with less subscribers than required RECEIVED a message. Required: ' + alert.minSubscribers + ', Subscribed: ' + alertsRes.queue.subscribed.length,
                alert
            };

            let message = alertsRes.queue.queueType + ' queue with less subscribers than required RECEIVED a message. Required: ' + alert.minSubscribers + ', Subscribed: ' + alertsRes.queue.subscribed.length;
            // If owner should be messaged
            if (alert.messageOwner) {
                alerts.alertActions[alert.typeCriteria](alertsRes.queue, message).then(() => {
                    console.log('alert.messageOwner done');
                }).catch(err => {
                   console.log(colors.red('alert.messageOwner err: ', err));
                });
            }

            // Escalate alert
            alerts.escalateAlert(alert, alertsRes.queue, message);
        });
      }
    });


    // Check for queue group name - if not found on req object, this is initial message - create new queue group
    if (req.body.queueGroup) {
      messageObj.queueGroup = req.body.queueGroup;
      messageObj.queueType = req.body.queueGroup.substr(0, req.body.queueGroup.indexOf('_'));
      // Save message to DB
      mongo.insert(messageObj, 'messages', message => {
        mongo.find({queueGroup: req.body.queueGroup}, 'queueGroups', (queueGroup) => {
            // Save alert to DB if triggered
            if (hasAlert) {
                alerts.save(queueGroup, req.body.number, message.ops[0], hasAlert);
            }
          // If response from number is not in responseFrom already
          if (queueGroup[0].responseFrom.indexOf(req.body.number) == -1) {
            console.log('Number not found in responseFrom');
            // Update response from filed of the queue group
            mongo.findOneAndUpdate({queueGroup: req.body.queueGroup}, {$push: {responseFrom: req.body.number}}, 'queueGroups', () => {
              // If it is acknowledgement message
              if (req.body.message == utils.acknolegmentCommand) {
                // Get original message and send to owner
                utils.sendAckMessage(req, deferred, queueGroup[0]);
              }
              deferred.resolve()
            });
          } else {
            // If it is acknowledgement message
            if (req.body.message == utils.acknolegmentCommand) {
              console.log('req.body.message == utils.acknolegmentCommand', req.body.message);
              // Get original message and send to owner
              utils.sendAckMessage(req, deferred, queueGroup[0]);
            } else {
              // Old responder but just a regular message
              console.log('Just resolving');
              deferred.resolve()
            }
          }
        })
      });
    } else {
      // Find queue type in DB
      mongo.findOne({queueType}, {}, 'queues', (queue) => {
        // Queue found, send a request to the bot to create new queue group and save the message
        if (queue && queue.active) {
            // Check if number is allowed to send
            if ((queue.allowedNumbersToSend.indexOf(req.body.number) == -1) && queue.allowedNumbersToSend.length) {
                // Send warning that number is not allowed to subscribe
                bot.sendMessage({
                    numbers: req.body.number,
                    message: 'Your number ' + req.body.number + ' does not have permission to send a message to the ' + queue.queueType + '. ' + queue.queueType + ' queue is owned by ' + queue.owner
                }).then(() => {
                    deferred.resolve();
                    console.log(colors.red(new Date(), req.body.number + 'is Not allowed to send a message to the ' + queue.queueType));
                });
            } else {
                let queueGroupName = utils.generateQueueGroupName(queueType);
                // Save the message to DB - collection 'messages'
                messageObj.queueGroup = queueGroupName;
                messageObj.queueType = queueType;

                let queueGroupObj = {
                    queueType,
                    queueGroup: queueGroupName,
                    responseFrom: [],
                    subscribers: utils.isInclusive(queue, req.body.number).split(','),
                    owner: req.body.number
                };

                // Saving message to DB
                mongo.insert(messageObj, 'messages', message => {
                    if (hasAlert) {
                        alerts.save(queueGroupObj, req.body.number, message.ops[0], hasAlert);
                    }
                    // Save new queue group to DB
                    mongo.insert(queueGroupObj, 'queueGroups', () => {
                        // Send a message via bot
                        console.log('sending the message', utils.PAobject);
                        bot.sendMessage({
                            numbers: utils.isInclusive(queue, req.body.number),
                            message: req.body.message + '\n Message by ' + req.body.number,
                            queueGroup: queueGroupName,
                            pa: utils.PAobject
                        }).then(() => {
                            let currentSubscriber = queue.subscribed.length <= 1 ? 'subscriber' : 'subscribers';

                            bot.sendMessage({
                                numbers: req.body.number,
                                message: 'A group message has been sent to the ' + queue.subscribed.length + ' current ' + currentSubscriber + ' to the ' + queueType + ' queue.'
                            }).then(() => {
                                console.log(colors.green('Message: "' + req.body.message + '" sent to group ' + queueGroupName + ', subscribers:' + queue.subscribed.toString().split(',').join(', ')));
                                deferred.resolve();
                            });
                        }).catch(err => {
                            console.log(colors.red('bot.createGroup err: ', err));
                        });
                    });
                });
            }
        } else if (queue && !queue.active) {
          // If queue is not active, send a message to sender
          bot.sendMessage({
            numbers: req.body.number,
            message: 'This queue is not active.'
          }).then(() => {
            console.log(colors.red('Sending a message to inactive ' + queueType + ' queue'));
            deferred.resolve();
          });
        } else {
          // Queue not found - send the alert message via bot
          bot.sendMessage({
            numbers: req.body.number,
            message: 'You cannot send a message to ' + queueType + '. The queue ' + queueType + ' does not exist.'
          }).then(() => {
            console.log(colors.red(queueType + ' queue is not found.'));
            deferred.reject({status: 404});
          });
        }
      });
    }
  }

  return deferred.promise;
}

module.exports = {
  getMessages,
  save
};
