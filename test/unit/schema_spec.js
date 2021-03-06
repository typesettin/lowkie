'use strict';
/*jshint expr: true*/
const path = require('path');
const events = require('events');
const chai = require('chai');
const fs = require('fs-extra');
const expect = require('chai').expect;
const testSchemaDBPath = path.join(__dirname, '../mock/schematestdb.json');
const lowkie = require('../../index');
const lowkieSchema = require('../../lib/schema');
const removeTestDB = require('../util/removeTestDB');
const moment = require('moment');
const testUserSchemaScheme = {
  name: String,
  email: String,
  active: Boolean,
  age: Number,
  location: Object,
  profile: {
    type: String,
    default: 'no profile',
  },
  account: {
    ref: 'testaccount',
    type: lowkieSchema.Types.ObjectId
  },
  associated_accounts: [{
    relationship: String,
    user: {
      ref: 'testaccount',
      type: lowkieSchema.Types.ObjectId
    }
  }],
  createdat: {
    type: Date,
    default: Date.now
  }
};
let testUserSchema;
let testUserModel;
let testAccountSchema;
let testAccountModel;

describe('Schema', function() {
  this.timeout(10000);
  before('intialize lowkie instances', (done) => {
    removeTestDB(testSchemaDBPath, false);
    lowkie.connect(testSchemaDBPath)
      .then(( /*db*/ ) => {
        // console.log('connected schematestdb');
        testUserSchema = lowkie.Schema(testUserSchemaScheme);
        testUserModel = lowkie.model('testuser', testUserSchema);
        testAccountSchema = lowkie.Schema({ name: String });
        testAccountModel = lowkie.model('testaccount', testAccountSchema);
        // console.log({testUserSchema})
        done();
      })
      .catch(done);
  });
  describe('Lowkie Schema', function() {
    it('should be an instance of a lowkieSchema', function() {
      expect(testUserSchema).to.be.an.instanceof(lowkieSchema)
        .and.to.be.an('object');
      expect(testUserSchema).and.to.have.property('createDoc');
      expect(testUserSchema).and.to.have.property('insert');
    });
    it('should have a static property that exports Schema Types', () => {
      expect(lowkieSchema.Types).to.be.an('object');
      expect(lowkieSchema.Types.String).to.deep.equal(String);
    });
  });
  describe('#LowkieSchema', () => {
    it('should include _id in valid schema properties', () => {
      expect(testUserSchema.validNames.indexOf('_id') !== -1).to.be.true;
    });
  });
  describe('#createDoc', () => {
    it('should always generate an Id', () => {
      expect(testUserSchema.createDoc({})._id).to.be.an('string');
      expect(Object.keys(testUserSchema.createDoc({})).length).to.eql(3);
    });
    it('should allow for custom Ids', () => {
      let customId = '1234';
      expect(testUserSchema.createDoc({ _id: customId, })._id).to.eql(customId);
    });
    it('should ignore invalid schema props', () => {
      let newUser = testUserSchema.createDoc({
        name: 'testuser',
        email: 'user@domain.tld',
        profile: 'mocha test',
        active: true,
        age: 18,
        invalidprop: 'whatever',
      });
      expect(newUser).to.be.an('object');
      expect(newUser.invalidprop).to.not.exist;
      expect(Object.keys(newUser).length).to.eql(7);
      expect(newUser._id).to.be.a('string');
    });
    it('should convert values to proper type', () => {
      let newUser = testUserSchema.createDoc({
        name: 'testuser',
        email: 'user@domain.tld',
        profile: 'mocha test',
        active: "true",
        age: "18",
        invalidprop: 'whatever',
      });
      expect(newUser.active).to.be.a('boolean');
      expect(newUser.age).to.be.a('number');
    });
  });
  it('Should define default schema props', () => {
    let newUser = testUserSchema.createDoc({
      name: 'testuser',
      email: 'user@domain.tld',
      active: true,
      age: 18
    });
    expect(newUser.profile).to.equal('no profile');
  });
  it('Should respect function definitions as default schema props', () => {
    let newUser = testUserSchema.createDoc({
      name: 'anothertestuser',
      email: 'anotheruser@domain.tld',
      active: true,
      age: 21
    });
    let date = moment();
    expect(moment(newUser.createdat).isSame(date, 'day')).to.be.true;
  });
  it('Should allow the definition of a populated field', (done) => {
    return testAccountModel.insert({
      name: 'Some Random Name'
    })
      .then(account => {
        expect(account[0]._id).to.be.ok;
        return testUserModel.insert({
          name: 'testuser',
          email: 'user@domain.tld',
          active: true,
          age: 18,
          account: account[0]._id
        });
      })
      .then(newUser => testUserModel.populate('account', { _id: newUser[0]._id }))
      .then(result => {
        result = result[0];
        expect(result.account).to.have.property('name');
        expect(result.account.name).to.equal('Some Random Name');
        done();
      })
      .catch(done);
  });
  it('Should allow the definition of a nested populated field', (done) => {
    return testAccountModel.insert({
      name: 'A Good Friend'
    })
      .then(account => {
        expect(account[0]).to.have.property('_id');
        return testUserModel.insert({
          name: 'anothertestuser',
          email: 'friend@domain.tld',
          active: true,
          age: 18,
          associated_accounts: [{
            relationship: 'friend',
            user: account[0]._id
          }, {
            relationship: 'friend',
            user: account[0]._id
          }]
        });
      })
      .then(newUser => testUserModel.populate('associated_accounts.user', { _id: newUser[0]._id }))
      .then(result => {
        result = result[0];
        expect(result.associated_accounts.length).to.equal(2);
        expect(result.associated_accounts[0].user.name).to.equal('A Good Friend');
        expect(result.associated_accounts[1].user.name).to.equal('A Good Friend');
        done();
      })
      .catch(done);
  });
  describe('#insert', () => {
    it('should return a promise', () => {
      expect(testUserSchema.insert()).to.be.an.instanceof(Promise);
    });
    it('should insert documents', (done) => {
      testUserSchema.insert({
          target: testUserModel.insert,
          thisArg: lowkie,
          argumentsList: {
            name: 'testuser',
            email: 'user@domain.tld',
            profile: 'mocha test',
            location: {
              lat: 30,
              lng: -15,
            },
            active: false,
            age: 18,
            invalidprop: 'whatever',
          },
        })
        .then(newdoc => {
          expect(newdoc).to.be.an('object');
          done();
        })
        .catch(done);
    });
    it('should insert multiple documents', (done) => {
      testUserSchema.insert({
          target: testUserModel.insert,
          thisArg: lowkie,
          argumentsList: [{
              name: 'testuser',
              email: 'user@domain.tld',
              profile: 'mocha test',
              active: true,
              age: 18,
              invalidprop: 'whatever',
            },
            {
              name: 'testuser2',
              email: 'user2domain.tld',
              profile: 'mocha test2',
              active: false,
              age: 19,
              invalidprop: 'whatever',
            }
          ],
        })
        .then(newdocs => {
          // console.log({newdocs})
          expect(newdocs).to.be.an('array');
          done();
        })
        .catch(done);
    });
  });
  after('remove test schema db', () => {
    removeTestDB(testSchemaDBPath, true);
  });
});