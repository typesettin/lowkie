'use strict';
const flatten = require('flat');
const ObjectId = require('./object_id');
const pluralize = require('pluralize');
const NESTED_PATH_INDEX_REPLACER = /^(.+\.){1,}(.+)$/;
const IGNORE_LOKI_FIELDS = ['meta.revision', 'meta.created', 'meta.version', '$loki'];

var isExternalRef = function(key) {
  let properties = key.split('.');
  return (properties[properties.length - 1] === 'ref');
};

var isTypeDef = function(key) {
  let properties = key.split('.');
  return (properties[properties.length - 1] === 'type');
};

var isDefaultDef = function(key) {
  let properties = key.split('.');
  return (properties[properties.length - 1] === 'default');
};

/**
 * proxy for creating new loki documents
 * 
 * @class lowkieSchema
 */
class lowkieSchema {
  constructor(scheme, lowkieSingleton, db = 'default') {
    this.scheme = scheme;
    this.flattenedScheme = Object.assign({},flatten(scheme),scheme);
    let flatKeys = Object.keys(this.flattenedScheme);
    this.default_defs = flatKeys.filter(isDefaultDef);
    this.external_refs = flatKeys.filter(isExternalRef);
    this.type_defs = flatKeys.filter(isTypeDef);
    this.validNames = Object.keys(this.flattenedScheme).reduce((result, key) => {
      let properties = key.split('.');
      let parentKey = properties.slice(0, properties.length - 1).join('.');
      if (this.default_defs.indexOf(key) === -1 && this.external_refs.indexOf(key) === -1 && this.type_defs.indexOf(key) === -1) {
        result.push(key);
      } else if (result.indexOf(parentKey) === -1) {
        result.push(parentKey);
      }
      return result;
    }, []).concat(['_id']);
    this.lowkie = lowkieSingleton;
    this.createDoc = this.createDocument.bind(this);
    this.dbconnection = db;
    if (!lowkieSingleton) {
      throw new Error('Invalid schema invocation, try using lowkie.Schema instead of Schema');
    }
    return this;
  }
  validateDocument(original_document) {
    let _document = Object.assign({}, flatten(original_document), original_document);
    
    _document = Object.keys(_document).reduce((result, key) => {
      if (_document[key]) {
        let indexedKey = key.replace(/^(.+\.){1,}(?:\d+\.)(.+)$/, '$10.$2');
        let validType = this.flattenedScheme[`${ key }.type`] || this.flattenedScheme[key] || this.flattenedScheme[`${ indexedKey }.type`] || this.flattenedScheme[indexedKey];
        if (validType === Date) {
          result[key] === new Date(_document[key]);
        }
        if (typeof _document[key] === 'string' && (validType === String || validType === ObjectId)) {
          result[key] = _document[key].toString();
        } else if (validType === Boolean) {
          result[key] = (_document[key]) ? true : false;
        } else if (validType === Number) {
          result[key] = Number(_document[key]);
        } else if (typeof _document[key] === 'object' && (Array.isArray(validType) ||validType === Array || validType === Object || typeof this.scheme[key] ==='object')) {
          result[key] = _document[key];
        }
      } else if (typeof original_document[ key ] === 'object' && typeof this.flattenedScheme[ key ] === 'function' && this.flattenedScheme[ key ] === Object) { //schema type mixed
        result[key] = original_document[key];
      }
        return result;
      }, { _id: _document._id });

      this.default_defs.forEach(key => {
        let documentKey = key.substring(0, key.indexOf('.default'));
        if (typeof this.flattenedScheme[key] === 'function') {
          if (this.flattenedScheme[`${ documentKey }.type`] === Date) {
            _document[documentKey] = (_document[documentKey]) ? _document[documentKey] : new Date();
          } else {
            _document[documentKey] = (_document[documentKey]) ? _document[documentKey] : this.flattenedScheme[key]();
          }
        } else {
          _document[documentKey] = (_document[documentKey]) ? _document[documentKey] : this.flattenedScheme[key];
        }
      });
      return flatten.unflatten(_document);
    }
    /**
     * returns validated document for lokijs
     * 
     * @param {any} doc 
     * @returns object
     * 
     * @memberOf lowkieSchema
     */
  createDocument(doc) {
    const _id = ObjectId.createId().toString();
    const newDoc = Object.assign({ _id }, doc, { _id });
    return this.validateDocument(newDoc);
  }
  createRawDocument(doc) {
    const _id = ObjectId.createId();
    const newDoc = this.validateDocument(doc);
    delete newDoc[ '$notstrict' ];
    return Object.assign({ _id }, newDoc, doc, {
      _id,
    });
  }
    /**
     * overwrites the default insert method
     * 
     * @param {any} options 
     * @returns Promise
     * 
     * @memberOf lowkieSchema
     */
  insert(options = {}) {
      let lokiCollectionInsert = options.target;
      let lowkieInstance = options.thisArg;
      let lowkieDocument = options.argumentsList;
      // let { target, thisArg, argumentsList, } = options;
      return new Promise((resolve, reject) => {
        try {
          let validatedDoc = this.createDoc;
          if((this.lowkie && this.lowkie.config && this.lowkie.config.strictSchemas===false)||(Array.isArray(lowkieDocument) && lowkieDocument[0]['$notstrict'])||(!Array.isArray(lowkieDocument) && lowkieDocument['$notstrict'])){
            validatedDoc = this.createRawDocument.bind(this);
          }
          let newDoc = (Array.isArray(lowkieDocument))
            ? lowkieDocument.map(lowkiedoc => validatedDoc(lowkiedoc))
            : validatedDoc(lowkieDocument);
          lokiCollectionInsert.call(lowkieInstance, newDoc);
          this.lowkie.dbs[this.dbconnection].saveDatabase((err) => {
            if (err) reject(err);
            else return resolve(newDoc);
          });
        } catch (e) {
          reject(e);
        }
      });
    }
    /**
     * overwrites the default remove method
     * 
     * @param {any} options 
     * @returns Promise
     * 
     * @memberOf lowkieSchema
     */
  remove(options = {}) {
    let lokiCollectionRemove = options.target;
    let lowkieInstance = options.thisArg;
    let lowkieDocument = options.argumentsList;
    function removeDoc(doc) {
      return new Promise((resolve, reject) => {
        try {
          let t = setTimeout(() => { 
            lokiCollectionRemove.call(lowkieInstance, doc);
            resolve(doc);
          }, 10);
        } catch (e) {
          reject(e);
        }
      });
    }

    // let { target, thisArg, argumentsList, } = options;
    return new Promise((resolve, reject) => {
      try {
        let deletePromise = (Array.isArray(lowkieDocument))
          ? Promise.all(lowkieDocument.map(ld=>removeDoc(ld)))
          : removeDoc(lowkieDocument);
        deletePromise
          .then(() => {
            this.lowkie.dbs[this.dbconnection].saveDatabase((err) => {
              if (err) reject(err);
              else return resolve(lowkieDocument);
            });
          })
          .catch(reject);
      } catch (e) {
        reject(e);
      }
    });
  }
  populate(model, refs = '', query = {}) {
    return new Promise((resolve, reject) => {
      try {
        let _refs = (Array.isArray(refs)) ? refs : refs.split(' ');
        _refs = _refs.map(ref => {
          if (ref && typeof ref === 'object') return ref;
          return { path: ref };
        });
        let collections = this.lowkie.dbs[this.dbconnection].collections;
        let flattened = this.flattenedScheme;
        let _documents = model.chain().find(query);
        let refpath;
        let populatedDocuments = _documents.data().reduce((result, doc) => {
          let flattenedDoc = flatten(doc);
          _refs.forEach(ref => {
            if (flattened[`${ ref.path }.ref`]) {
              refpath = `${ ref.path }.ref`
            } else if (flattened[`${ ref.path }.0.ref`] || flattened[`${ ref.path.replace(NESTED_PATH_INDEX_REPLACER, '$10.$2') }.ref`]) {
              refpath = (flattened[`${ ref.path }.0.ref`]) ? `${ ref.path }.0.ref` : `${ ref.path.replace(NESTED_PATH_INDEX_REPLACER, '$10.$2') }.ref`;
            }
            // console.log({flattened})
            if (flattened[`${ ref.path }.ref`]) {
              let name = pluralize(flattened[`${ref.path}.ref`]).toLowerCase();
              let toPopulate = collections.filter(collection => collection.name.toLowerCase() === name)[0];
              let _id = flattenedDoc[ref.path];
              if (_id) {
                let childDocument = toPopulate.chain().find({ _id }).data()[0];
                flattenedDoc[ref.path] = childDocument || null;
              }
            } else if (!flattened[`${ ref.path }.ref`] && refpath) {
              let reference = flattened[refpath];
              let name = pluralize(reference).toLowerCase();
              let toPopulate = collections.filter(collection => collection.name.toLowerCase() === name)[ 0 ];
              // console.log({toPopulate,reference,refpath,name})
              let nestedIndex = 0;
              let entityPath = refpath.substring(0, refpath.indexOf('.ref'));
              let _id = flattenedDoc[entityPath];
              while (_id) {
                let childDocument = toPopulate.chain().find({ _id }).data()[0];
                flattenedDoc[entityPath] = childDocument || null;
                let reversed = entityPath.split('.').reverse();
                if (typeof reversed[0] === 'number') {
                  reversed[0] = ++nestedIndex;
                  entityPath = reversed.reverse().join('.');
                } else {
                  reversed.splice(reversed.indexOf(nestedIndex.toString()), 1, ++nestedIndex);
                  entityPath = reversed.reverse().join('.');
                }
                _id = flattenedDoc[entityPath];
              }
            }
          });
          return result.concat(flatten.unflatten(flattenedDoc));
        }, []);
        resolve(populatedDocuments);
      } catch (e) {
        reject(e);
      }
    });
  }
}

/**
 * schema data types
 */
lowkieSchema.Types = {
  String,
  Buffer,
  Date,
  Number,
  ObjectId,
  Array,
  Mixed: Object,
};

module.exports = lowkieSchema;