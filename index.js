function _defineProperty(obj, key, value) {
  if (key in obj) {
    Object.defineProperty(obj, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  } else {
    obj[key] = value;
  }
  return obj;
}

var Sequelize = require('sequelize');

function capitalize(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

function toArray(value) {
  return Array.isArray(value) ? value : [value];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cloneAttrs(model, attrs, excludeAttrs) {
  var clone = {};
  var attributes = model.rawAttributes || model.attributes;
  for (var p in attributes) {
    if (excludeAttrs.indexOf(p) > -1) continue;
    var nestedClone = {};
    var attribute = attributes[p];
    for (var np in attribute) {
      if (attrs.indexOf(np) > -1) {
        nestedClone[np] = attribute[np];
      }
    }
    clone[p] = nestedClone;
  }
  return clone;
}

var VersionType = {
  CREATED: 1,
  UPDATED: 2,
  DELETED: 3,
  READ: 4,
};

var Hook = {
  AFTER_CREATE: 'afterCreate',
  AFTER_UPDATE: 'afterUpdate',
  AFTER_DESTROY: 'afterDestroy',
  AFTER_SAVE: 'afterSave',
  AFTER_BULK_CREATE: 'afterBulkCreate',
  AFTER_BULK_UPDATE: 'afterBulkUpdate',
  AFTER_FIND: 'afterFind',
  BEFORE_CREATE: 'beforeCreate',
  BEFORE_UPDATE: 'beforeUpdate',
  BEFORE_DESTROY: 'beforeDestroy',
  BEFORE_SAVE: 'beforeSave',
  BEFORE_BULK_CREATE: 'beforeBulkCreate',
  BEFORE_BULK_UPDATE: 'beforeBulkUpdate',
  BEFORE_FIND: 'beforeFind',
};

var defaults = {
  prefix: 'version',
  attributePrefix: '',
  suffix: '',
  schema: '',
  namespace: null,
  sequelize: null,
  exclude: [],
  tableUnderscored: true,
  underscored: true,
  versionAttributes: null,
};

function isEmpty(string) {
  return [undefined, null, NaN, ''].indexOf(string) > -1;
}

var hooks = [
  Hook.AFTER_CREATE,
  Hook.AFTER_UPDATE,
  Hook.AFTER_BULK_CREATE,
  Hook.AFTER_BULK_UPDATE,
  Hook.AFTER_DESTROY,
];

var attrsToClone = ['type', 'field', 'get', 'set'];

function getVersionType(hook) {
  switch (hook) {
  case Hook.BEFORE_CREATE:
  case Hook.BEFORE_BULK_CREATE:
  case Hook.AFTER_CREATE:
  case Hook.AFTER_BULK_CREATE:
    return VersionType.CREATED;
  case Hook.BEFORE_BULK_UPDATE:
  case Hook.BEFORE_UPDATE:
  case Hook.AFTER_BULK_UPDATE:
  case Hook.AFTER_UPDATE:
    return VersionType.UPDATED;
  case Hook.BEFORE_DESTROY:
  case Hook.AFTER_DESTROY:
    return VersionType.DELETED;
  case Hook.BEFORE_FIND:
  case Hook.AFTER_FIND:
    return VersionType.READ;
  }
  throw new Error('Version type not found for hook ' + hook);
}

function Version(model, customOptions) {
  var _versionAttrs;

  var options = Object.assign({}, defaults, Version.defaults, customOptions);

  var prefix = options.prefix,
    suffix = options.suffix,
    namespace = options.namespace,
    exclude = options.exclude,
    tableUnderscored = options.tableUnderscored,
    underscored = options.underscored;

  if (isEmpty(prefix) && isEmpty(suffix)) {
    throw new Error('Prefix or suffix must be informed in options.');
  }

  var sequelize = options.sequelize || model.sequelize;
  var schema = options.schema || model.options.schema;
  var attributePrefix = options.attributePrefix || options.prefix;
  var tableName =
    '' +
    (prefix ? '' + prefix + (tableUnderscored ? '_' : '') : '') +
    (model.options.tableName || model.name) +
    (suffix ? '' + (tableUnderscored ? '_' : '') + suffix : '');
  var versionFieldType =
    '' + attributePrefix + (underscored ? '_t' : 'T') + 'ype';
  var versionFieldId = '' + attributePrefix + (underscored ? '_i' : 'I') + 'd';
  var versionFieldTimestamp =
    '' + attributePrefix + (underscored ? '_t' : 'T') + 'imestamp';
  var versionFieldUser =
    '' + attributePrefix + (underscored ? '_u' : 'U') + 'serId';
  var versionModelName = '' + capitalize(prefix) + capitalize(model.name);

  var versionAttrs =
    ((_versionAttrs = {}),
    _defineProperty(_versionAttrs, versionFieldId, {
      type: Sequelize.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    }),
    _defineProperty(_versionAttrs, versionFieldType, {
      type: Sequelize.INTEGER,
      allowNull: false,
    }),
    _defineProperty(_versionAttrs, versionFieldTimestamp, {
      type: Sequelize.DATE,
      allowNull: false,
    }),
    _versionAttrs);

  var cloneModelAttrs = cloneAttrs(model, attrsToClone, exclude);
  var versionModelAttrs = Object.assign({}, cloneModelAttrs, versionAttrs);

  var versionModelOptions = {
    schema,
    tableName,
    timestamps: false,
  };

  var versionModel = sequelize.define(
    versionModelName,
    versionModelAttrs,
    versionModelOptions
  );

  versionModel.belongsTo(options.userModel, { foreignKey: versionFieldUser });

  var requestedHooks = options.hooks || hooks;

  // Make sure individual entity events are always triggered, even when bulk creating / updating.
  // This is required for maintaining single-entity histories:
  model.addHook('beforeBulkCreate', function(options) {
    options.individualHooks = true;
  });

  model.addHook('beforeBulkUpdate', function(options) {
    options.individualHooks = true;
  });
  model.addHook('afterBulkCreate', function(options) {
    options.individualHooks = true;
  });

  model.addHook('afterBulkUpdate', function(options) {
    options.individualHooks = true;
  });

  requestedHooks.forEach(function(hook) {
    model.addHook(hook, function(instanceData, _ref) {
      var transaction = _ref ? _ref.transaction : null;

      var cls = namespace || Sequelize.cls;

      var versionTransaction = void 0;

      if (sequelize === model.sequelize) {
        versionTransaction = cls
          ? cls.get('transaction') || transaction
          : transaction;
      } else {
        versionTransaction = cls ? cls.get('transaction') : undefined;
      }

      var versionType = getVersionType(hook);
      var instancesData = toArray(instanceData);

      var currentUser = options.getUserFn();

      if (
        options.auditConditionFn &&
        !options.auditConditionFn(
          model,
          instancesData,
          versionType,
          currentUser
        )
      ) {
        return;
      }

      var versionData = instancesData.map(function(data) {
        var _Object$assign;

        return Object.assign(
          {},
          clone(data),
          ((_Object$assign = {}),
          _defineProperty(_Object$assign, versionFieldType, versionType),
          _defineProperty(_Object$assign, versionFieldTimestamp, new Date()),
          _defineProperty(
            _Object$assign,
            versionFieldUser,
            currentUser ? currentUser.id : null
          ),
          _Object$assign)
        );
      });

      return versionModel.bulkCreate(versionData, {
        transaction: versionTransaction,
      });
    });
  });

  versionModel.addScope('created', {
    where: _defineProperty({}, versionFieldType, VersionType.CREATED),
  });

  versionModel.addScope('updated', {
    where: _defineProperty({}, versionFieldType, VersionType.UPDATED),
  });

  versionModel.addScope('deleted', {
    where: _defineProperty({}, versionFieldType, VersionType.DELETED),
  });

  function getVersions(params) {
    var _this = this;

    var versionParams = {};
    var modelAttributes = model.rawAttributes || model.attributes;
    var primaryKeys = Object.keys(modelAttributes).filter(function(attr) {
      return modelAttributes[attr].primaryKey;
    });

    if (primaryKeys.length) {
      versionParams.where = primaryKeys
        .map(function(attr) {
          return _defineProperty({}, attr, _this[attr]);
        })
        .reduce(function(a, b) {
          return Object.assign({}, a, b);
        });
    }

    if (params) {
      if (params.where)
        versionParams.where = Object.assign(
          {},
          params.where,
          versionParams.where
        );
      versionParams = Object.assign({}, params, versionParams);
    }

    return versionModel.findAll(versionParams);
  }

  // Sequelize V4 and above
  if (model.prototype) {
    if (!model.prototype.hasOwnProperty('getVersions')) {
      model.prototype.getVersions = getVersions;
    }

    //Sequelize V3 and below
  } else {
    var hooksForBind = hooks.concat([Hook.AFTER_SAVE]);

    hooksForBind.forEach(function(hook) {
      model.addHook(hook, function(instance) {
        var instances = toArray(instance);
        instances.forEach(function(i) {
          if (!i.getVersions) i.getVersions = getVersions;
        });
      });
    });
  }

  if (!model.getVersions) {
    model.getVersions = function(params) {
      return versionModel.findAll(params);
    };
  }

  return versionModel;
}

Version.defaults = Object.assign({}, defaults);
Version.VersionType = VersionType;
Version.Hook = Hook;

module.exports = Version;
