const config = require('../config.json');
const mongo = require('../mongo');
const q = require('q');

module.exports = {
  resolveGet,
  aggregate
}

// GET routes generic resolve function
function resolveGet(req, collection, filter = {}, projection = {}) {
  const deferred = q.defer();
  let pageSize = parseInt(req.query.pageSize) || config.pageSize;
  const skip = 0 || (parseInt(req.query.page) - 1) * pageSize; // Zero based, page number starts at 1
  let totalPages = 0;
  function callback(docs) {
    deferred.resolve({
      totalPages: totalPages,
      items: docs
    })
  }

  // If there is parameter "search" on the request, do text search on DB
  if (req.query.search) {
    filter['queueType'] = new RegExp(req.query.search);
  }

  // Get total number of pages
  mongo.find(filter, collection, (docs) => {
    totalPages = Math.ceil(docs.length/pageSize);
    mongo.find(filter, collection, callback, skip, pageSize, projection); // Get only filtered documents
  });

  return deferred.promise;
}

function aggregate(req, collection, sort = {}, group = {}, filter = '', match = {}) {
  const deferred = q.defer();
  let pageSize = parseInt(req.query.pageSize) || config.pageSize;
  const skip = 0 || (parseInt(req.query.page) - 1) * pageSize; // Zero based, page number starts at 1
  let totalPages = 0;
  function callback(docs) {
    deferred.resolve({
      totalPages: totalPages,
      items: docs
    })
  }

  let options = {
    skip,
    limit: pageSize,
    filter: ''
  };

  // If there is parameter "search" on the request, do text search on DB
  if (req.query.search) {
    options.filter = new RegExp(req.query.search);
  }

  // Get total number of pages
  mongo.aggregate('messages', sort, group, {skip: 0, limit: 10000, filter: new RegExp(req.query.search)}, match, (docs) => {
    totalPages = Math.ceil(docs.length/pageSize);
    mongo.aggregate('messages', sort, group, options, match, callback); // Get only filtered documents
  });

  return deferred.promise;
}
