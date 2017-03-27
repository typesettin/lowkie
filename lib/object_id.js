'use strict';
const crypto = require('crypto');

class ObjectId{
  static createId() {
    let _id = crypto.createHash('md5').update(`${new Date().valueOf}${Math.random()}`).digest('hex');
    return _id;
  }
  constructor() {
  }
}
module.exports = ObjectId;