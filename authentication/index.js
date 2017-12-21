const passportJWT = require('passport-jwt');
const _ = require('lodash');
const secretKey = require('../secrets/privateKey.json');
const mongo = require('../mongo/index.js');

const ExtractJwt = passportJWT.ExtractJwt;
const JwtStrategy = passportJWT.Strategy;

const jwtOptions = {
  secretOrKey: secretKey.key,
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken()
};

const strategy = new JwtStrategy(jwtOptions, function(jwt_payload, next) {
  console.log('payload received', jwt_payload);
  // usually this would be a database call:
  const users = mongo.find({}, 'admins');
  let user = users[_.findIndex(users, {id: jwt_payload.id})];
  if (user) {
    next(null, user);
  } else {
    next(null, false);
  }
});

module.exports = {
  strategy,
  jwtOptions
};
