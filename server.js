const appPort = 3000;

const express = require('express');
const app = express();

const server = app.listen(appPort, () => {
  console.log('App is running on port:', appPort);
});

const bodyParser = require('body-parser');
const passport = require('passport');
const io = require('socket.io').listen(server);
const fs = require('fs');

const authentication = require('./authentication');
const mongo = require('./mongo');
const resolver = require('./resolver');
const userManagement = require('./user_management');
const messages = require('./messages');
const alerts = require('./alerts');
const queues = require('./queues');
const config = require('./config.json');
const downloader = require('./downloader');
const formidable = require('formidable');
const subscribers = require('./subscribers');
const Alerts = require('./alerts');
const interceptor = require('express-interceptor');
const writeFile = require('write');
var readFile = require('read-file');


const os = require("os");

io.on('connection', () => {
  console.log('A user connected');
});

passport.use(authentication.strategy);

// Intercept requests and write those in log file
const reqInterceptor = interceptor(function(req, res){
    return {
        isInterceptable: function(){
            if (req.headers.authorization) {
                return true;
            }

            return false
        },
        intercept: function(body, send) {
            mongo.findOne({token: req.headers.authorization.split(' ')[1]}, {}, 'token_store', (user) => {
                readFile('access.log', 'utf8', (err, buffer = '') => {
                    writeFile('access.log', buffer + '\n' + new Date + ' ' + user.user + ' ' + req.method + ' ' + req.path + ' ' + JSON.stringify(req.body) + ' ' + res.statusCode, function(err) {
                        if (err) console.log(err);
                    });
                });
            });
            send(body);
        }
    };
});

app
    .use(passport.initialize())
    // Parse application/x-www-form-urlencoded
    .use(bodyParser.urlencoded({extended: true}))
    .use(bodyParser.json()) // Parse application/json
    .use(bodyParser.text())
    .use(reqInterceptor)
    .use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', config.allowOrigin);
        res.header('Access-Control-Allow-Credentials', 'true');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        next();
  });

// GET routes
app
  .get('/messages', passport.authenticate('jwt', { session: false }), (req, res) => { // Get list of messages
    messages.getMessages(req).then((messages) => {
      res.send(messages);
    })
  })
  .get('/alerts', passport.authenticate('jwt', { session: false }), (req, res) => { // Get list of alerts
    resolver.resolveGet(req, 'alerts').then(alerts => {
      res.send(alerts);
    });
  })
  .get('/queues', passport.authenticate('jwt', { session: false }), (req, res) => { // Get list of queues
    resolver.resolveGet(req, 'queues').then(queues => {
      res.send(queues);
    });
  })
  .get('/subscribers', passport.authenticate('jwt', { session: false }), (req, res) => { // Get list of subscribers
        if(req.query.status === 'active') {
            // Hard coding this since there is no difference between active and subscribed
            req.query.status = 'subscribed';
        }

        let filter = {};
        if (req.query.status) {
            filter = {status: req.query.status};
        }
        resolver.resolveGet(req, 'subscribers', filter).then(subscribers => {
            res.send(subscribers);
        });
  })
  .get('/users', passport.authenticate('jwt', { session: false }), (req, res) => { // Get list of users
    resolver.resolveGet(req, 'users').then(users => {
      res.send(users);
    });
  })
  .get('/messages/queue/:name', (req, res) => { // Get messages per queue
    mongo.find({queueGroup: req.params.name}, 'messages', (messages) => {
      res.send(messages);
    })
  })
  .get('/hospital/details', passport.authenticate('jwt', {session: false}), (req, res) => {
    res.send({
      hospitalName: config.hospitalName,
      email: config.email,
      telephone: config.telephone
    })
  })
  .get('/messagesCsv', (req, res) => {
    messages.getMessages(req).then((messages) => {
      messages.items.map(message => {
        // Remove array braces and return only comma separated strings
        if (message.responseFrom) {
          message.responseFrom = message.responseFrom.toString();
        }
        // Remove array braces and return only comma separated strings
        if (message.subscribers) {
          message.subscribers = message.subscribers.toString();
        }
      });

      downloader.csv(res, ['_id', 'queueType', 'queueGroup', 'time', 'sender', 'message', 'responseFrom', 'subscribers'], messages);
    })
  })
  .get('/subscribersCsv', passport.authenticate('jwt', {session: false}), (req, res) => {
    resolver.resolveGet(req, 'subscribers').then(subscribers => {
      downloader.csv(res, ['_id', 'queueGroup', 'queueType', 'sender', 'status'], subscribers);
    });
  })
  .get('/logo.png', (req, res) => {
    const img = fs.readFileSync('./logo.png');
    res.writeHead(200, {'Content-Type': 'image/png' });
    res.end(img, 'binary');
  })
  .get('/messages/queue/csv/:name', passport.authenticate('jwt', {session: false}), (req, res) => {
    mongo.find({queueGroup: req.params.name}, 'messages', (messages) => {
      // Put messages in form expected by downloader module
      let items = {
        items: messages
      };
      downloader.csv(res, ['_id', 'sender', 'message', 'time', 'queueGroup', 'queueType'], items);
    })
  })

// POST routes
app
  .post('/login', (req, res) => {
    authentication.login(req).then(user => {
      res.json(user);
    }).catch(err => {
      res.status(err.status).send(err.message);
    });
  })
  .post('/createUser', passport.authenticate('jwt', {session: false}), (req, res) => {
    userManagement.create(req, res).then(() => {
      res.status(200).send({status: 'ok'});
    }).catch(err => {
      res.status(400).send(err);
    });
  })
  .post('/forgotPassword', (req, res) => {
    authentication.forgotPassword(req).then(() => {
      res.status(200).send({status: 'ok'});
    }).catch(() => {
      res.status(400).send({message: 'Email not found'});
    })
  })
  .post('/passwordChange', passport.authenticate('jwt', {session: false}), (req, res) => {
    authentication.passwordChange(req).then(() => {
      res.status(200).send({status: 'ok'});
    }).catch((err) => {
      res.status(err.status).send({message: err.message});
    })
  })
  .post('/alerts/sendMail', passport.authenticate('jwt', {session: false}), (req, res) => {
    alerts.sendMail(req).then(() => {
      res.status(200).send({status: 'ok'});
    }).catch(err => {
      res.status(400).send({message: err.message})
    })
  })
  .post('/alerts/sendSms', passport.authenticate('jwt', {session: false}), (req, res) => {
    alerts.sendSms(req).then(() => {
      res.status(200).send({status: 'ok'});
    }).catch(err => {
      res.status(err.status).send({message: err.message})
    })
  })
  .post('/queues/editStatus', passport.authenticate('jwt', {session: false}), (req, res) => {
    queues.editStatus(req).then(() => {
      res.status(200).send({status: 'ok'});
    }).catch(err => {
      res.status(err.status).send({message: err.message})
    })
  })
  .post('/queues/create', (req, res) => {
    queues.create(req).then((doc) => {
      res.send(doc);
    }).catch(err => {
      res.status(err.status).send({message: err.message})
    })
  })
  .post('/users/edit', passport.authenticate('jwt', {session: false}), (req, res) => {
    userManagement.edit(req).then(() => {
      res.status(200).send({status: 'ok'});
    }).catch(err => {
      res.status(err.status).send({message: err.message})
    })
  })
  .post('/users/editStatus', passport.authenticate('jwt', {session: false}), (req, res) => {
    userManagement.editStatus(req).then(() => {
      res.status(200).send({status: 'ok'});
    }).catch(err => {
      res.status(err.status).send({message: err.message})
    })
  })
  .post('/hospital/details', passport.authenticate('jwt', {session: false}), (req, res) => {
    let request = JSON.parse(req.body);
    config.hospitalName = request.hospitalName;
    config.telephone = request.telephone;
    config.email = request.email;
    fs.writeFileSync('./config.json', JSON.stringify(config));

    res.send({
      hospitalName: config.hospitalName,
      telephone: config.telephone,
      email: config.email
    });
  })
  .post('/logoUpload', passport.authenticate('jwt', {session: false}), (req, res) => {
    const form = new formidable.IncomingForm();
    form.uploadDir = '.';

    form.parse(req, function (err, fields, files) {
      for (let key in files) {
        if (files[key].type != 'image/png') {
          res.status(400).send({message: 'File ' + files[key].name + ' is not type of png! Plese, upload png format file.'});
        } else {
          // If file logo.png  exists delete it and replace with the new one
          if (fs.existsSync('./logo.png')) {
            fs.unlinkSync('./logo.png');
          }

          fs.rename('./' + files[key].path, './logo.png', () => {
            res.status(200).send({status: 'ok'});
          });
        }
      }
    });
  })
  .post('/subscribe', passport.authenticate('jwt', {session: false}), (req, res) => {
    subscribers.subscribe(req).then(() => {
      io.emit('subscribe', { get: '/subscribers' });
      res.sendStatus(200);
    }).catch(err => {
      res.status(err.status).send({message: err.message});
    });
  })
  .post('/unsubscribe', passport.authenticate('jwt', {session: false}), (req, res) => {
    subscribers.unsubscribe(req).then(() => {
      io.emit('subscribe', { get: '/subscribers' });
      res.sendStatus(200);
    }).catch(err => {
      res.status(err.status).send({message: err.message});
    });
  })
  .post('/message', passport.authenticate('jwt', {session: false}), (req, res) => {
    messages.save(req).then(() => {
      io.emit('message', { get: '/messages' });
      res.sendStatus(200);
    }).catch(err => {
      res.sendStatus(err.status);
    })
  })
  .post('/queues/edit', passport.authenticate('jwt', {session: false}), (req, res) => {
    queues.edit(req).then((queue) => {
      res.status(200).send(queue);
    }).catch(err => {
        res.status(err.status).send({message: err.message});
    })
  });

// Cronjob that runs on every minute to check if there is alert that should be triggered
setInterval(() => {
    Alerts.cron();
}, 30000);
