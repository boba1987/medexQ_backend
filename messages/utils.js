const dateformat = require('dateformat');
const q = require('q');
const mongo = require('../mongo');
const bot = require('../bot');

const acknolegmentCommand = '**ACKNOWLEDGED**';

const PAobject = [
    {
        'id': '1',
        'input': 'false',
        'style': {
            'bg_color': ''
        },
        'rows': [
            {
                'style': {
                    'size': '1.25',
                    'bg_color': ''
                },
                'cells': [
                    {
                        'title' : 'Acknowledge',
                        'cmd'   : acknolegmentCommand,
                        'input' : 'false',
                        'echo'  : 'true',
                        'style': {
                            'color'   : '#ffffff',
                            'border'  : '#6cbd43',
                            'bg_color': '#6cbd43',
                            'width'   : '1'
                        }
                    }
                ]
            }
        ]
    }
];

module.exports = {
  generateQueueGroupName,
  isInclusive,
  PAobject,
  acknolegmentCommand,
  getOriginalQueueGroupMessage,
  sendAckMessage
}

// Get original queue group message
function getOriginalQueueGroupMessage(queueGroup) {
  const deferred = q.defer();

  mongo.findOne({queueGroup}, {sort: {time: 1}}, 'messages', (message) => {
    deferred.resolve(message);
  });

  return deferred.promise;
}

function generateQueueGroupName(name) {
  const currDate = new Date();

  let generatedName = name + dateformat(currDate, '_HHMMss_ddmmyyyy');

  return generatedName;
}

// Utility function that checks if queue is type of inclusive
function isInclusive(queue, sender) {
  let numbersToSend = queue.subscribed.slice(0);

  // Check if queue is type of inclusive and if it is add sender if not in queue subscribers
  if (queue.isInclusive && queue.subscribed.indexOf(sender) == -1) {
    numbersToSend.push(sender);
    return numbersToSend.toString().split(',').join(', ');
  } else {
    // Number is either found in subscribers or queue is type of exclusive
    return numbersToSend.toString().split(',').join(', ');
  }
}

function sendAckMessage(req, deferred, queueGroup) {
  // Get original message
  console.log(new Date, '// Get original message for sending ACK to initiator');
  console.log('req.body ', req.body);
  console.log('queueGroup ', queueGroup);
  getOriginalQueueGroupMessage(queueGroup.queueGroup).then((originalMsg) => {
    // Send acknolegment message to queue group original message sender
    bot.sendMessage({
      numbers: queueGroup.owner,
      message: req.body.number + ' Acknowledged the message "' + originalMsg.message + '"'
    }).then(() => {
      deferred.resolve();
    })
  })
}
