/*
 * Edited version of simpleASEndpoint.js 
 * 
 * All Endpoints need to have at least the following:
 * annotationsList - current list of OA Annotations
 * dfd - Deferred Object
 * init()
 * search(uri)
 * create(oaAnnotation, returnSuccess, returnError)
 * update(oaAnnotation, returnSuccess, returnError)
 * deleteAnnotation(annotationID, returnSuccess, returnError) (delete is a reserved word)
 * TODO:
 * There is a bug in that if you create an annotation and then delete it (without moving pages) then click either the write annotation button 
 * or try to create a new annotation the deleted annotation re-appears. Changing pages fixes the issue as the annoation is delete from the annotation store
 *
 */
(function($){

  $.WAProtocolEndpoint = function(options) {

    jQuery.extend(this, {
      token:     null,
      uri:      null,
      url:		  options.url,
      dfd:       null,
      annotationsList: [],        //OA list for Mirador use
      idMapper: {} // internal list for module use to map id to URI
    }, options);

    this.init();
  };

  $.WAProtocolEndpoint.prototype = {
    // Shouldn't need any initialization
    init: function() {
    },

    //Search endpoint for all annotations with a given URI
    search: function(options, successCallback, errorCallback) {
      var _this = this;

      this.annotationsList = []; //clear out current list
      jQuery.ajax({
        url: _this.url, // container?target=(uri)
        cache: false,
        type: 'GET',
        dataType: 'json',
        headers: {
        },
        data: {
          target: options.uri,
          user : options.userid ? options.userid : undefined,
          q : options.text ? options.text : undefined
        },

        contentType: "application/json",

        success: function(data) {
          if (typeof successCallback === "function") {
            successCallback(data);
          } else {
            results = data.first.items;
            _this.annotationsList = results; 
            jQuery.each(_this.annotationsList, function(index, value) {
              value.fullId = value.id;
             value.id = $.genUUID();
              _this.idMapper[value.id] = value.fullId;
              value.endpoint = _this;
            });
            _this.dfd.resolve(false);
          }
        },

        error: function() {
          if (typeof errorCallback === "function") {
            errorCallback();
          } else {
            console.log("The request for annotations has caused an error for endpoint: "+ options.uri);
          }
        }

      });
    },

    deleteAnnotation: function(annotationID, returnSuccess, returnError) {
      var _this = this;
      jQuery.ajax({
        url: annotationID,
        type: 'DELETE',
        dataType: 'json',
        headers: {
        },
        data: {
        },
        contentType: "application/ld+json",
        success: function(data) {
          returnSuccess();
        },
        error: function() {
          returnError();
        }

      });
    },

    update: function(oaAnnotation, returnSuccess, returnError) {
      var annotation = oaAnnotation,
          _this = this;

      shortId = annotation.id;
      annotation.id = annotation.fullId;
      annotationID = annotation.fullId; 
      delete annotation.fullId;
      delete annotation.endpoint;

      // XXX This should send If-Match: etag
      // ... but another day

      jQuery.ajax({
        url: annotationID,
        type: 'PUT',
        dataType: 'json',
        headers: {
        },
        data: JSON.stringify(annotation),
        contentType: "application/ld+json",
        success: function(data) {
          /* this returned data doesn't seem to be used anywhere */
          returnSuccess();
        },
        error: function() {
          returnError();
        }
      });
      // this is what updates the viewer
      annotation.endpoint = _this;
      annotation.fullId = annotation.id;
      annotation.id = shortId;
    },

    create: function(oaAnnotation, returnSuccess, returnError) {
      var annotation = oaAnnotation,
          _this = this;

      annotation.target = annotation.on;
      annotation.body = annotation.resource;
      annotation.type = "Annotation";
      annotation.target[0].source = annotation.target[0].full;
      

      jQuery.ajax({
        url: _this.url,
        type: 'POST',
        dataType: 'json',
        headers: {
        },
        data: JSON.stringify(annotation),
        contentType: "application/ld+json",
        success: function(data) {
          data.fullId = data.id;
          data.id = $.genUUID();
          data.endpoint = _this;
          _this.idMapper[data.id] = data.fullId;

          returnSuccess(data);
        },
        error: function() {
          returnError();
        }
      });
    },

    set: function(prop, value, options) {
      if (options) {
        this[options.parent][prop] = value;
      } else {
        this[prop] = value;
      }
    },
    userAuthorize: function(action, annotation) {
      return true; // allow all
    }
  };
}(Mirador));
