// Auth Profiles
const PROFILE_LOGIN = 'http://iiif.io/api/auth/1/login';
const PROFILE_CLICKTHROUGH = 'http://iiif.io/api/auth/1/clickthrough';
const PROFILE_KIOSK = 'http://iiif.io/api/auth/1/kiosk';
const PROFILE_EXTERNAL = 'http://iiif.io/api/auth/1/external';
const PROFILE_TOKEN = 'http://iiif.io/api/auth/1/token';
const PROFILE_LOGOUT = 'http://iiif.io/api/auth/1/logout';

let viewer = null;   
let messages = {}

var dataServices = "";


// Mirador plugin
var Login = {
  /* initializes the plugin */
  init: function(){
    i18next.on('initialized', function(){
      this.addLocalesToViewer();
    }.bind(this));
    this.injectWorkspaceEventHandler();
    console.log("Initializing Auth...");
    Mirador.BookView.prototype.currentImage = Mirador.ImageView.prototype.currentImage = this.currentImage;
    // Overwrite toggleFocus to add AuthService lookup
    Mirador.Window.prototype.toggleFocus = this.toggleFocus;
  },


  /* injects the needed workspace event handler */
  injectWorkspaceEventHandler: function(){
    var this_ = this;
    var origFunc = Mirador.Workspace.prototype.bindEvents;
    Mirador.Workspace.prototype.bindEvents = function(){
      var workspace = this;
      
      this.eventEmitter.subscribe('windowUpdated', function(event, data){
        if(!data.loadedManifest){
          return;
        }


        let info = data.authService["@id"] + "/info.json";

        var dataService = $.ajax({
              url: info,
              dataType: 'json',
              // async: false
            })
            .done(function(data) {
              dataServices = JSON.stringify(data.service);
              // console.log(dataServices);
              console.log("info.json found");
              authChain();
            })
            .fail(function(data) {
              console.log("Data not found in " + JSON.stringify(data.service));
            });

        function loadInfo(imageServiceId, token) {
          return new Promise((resolve, reject) => {
            const request = new XMLHttpRequest();
            request.open('GET', imageServiceId + "/info.json");
            if(token){
              request.setRequestHeader("Authorization", "Bearer " + token);
            }
            request.onload = function(){
              try {
                  if(this.status === 200 || this.status === 401){
                      resolve({
                          info: JSON.parse(this.response),
                          status: this.status,
                          requestedId: imageServiceId
                      });
                  } else {
                      reject(this.status + " " + this.statusText);
                  } 
              } catch(e) {
                  reject(e.message);
              }
            };
            // console.log(request);
            request.onerror = function() {
                reject(this.status + " " + this.statusText);
            };        
            request.send();
            // test to see if setRequestHeader is working
            // request.onreadystatechange = function() {
            //   if(this.readyState == this.HEADERS_RECEIVED) {
            //     console.log("Response headers: " + request.getAllResponseHeaders());
            //   }
            // }
          });
        }

        function openContentProviderWindow(service){
          // console.log(service);
          let cookieServiceUrl = service + "?origin=" + getOrigin();
          // let cookieServiceUrl = "http://media.getty.edu/auth/login?origin=" + getOrigin(); // forced way to generate cookie, change to https when that is implemented
          console.log("Opening content provider window: " + cookieServiceUrl);
          return window.open(cookieServiceUrl);
        }

        function userInteractionWithContentProvider(contentProviderWindow){
          return new Promise((resolve) => {
              // What happens here is forever a mystery to a client application.
              // It can but wait.
              var poll = window.setInterval(() => {
                  // contentProviderWindow.close(); // close automatically for our purposes
                  if(contentProviderWindow.closed){
                      console.log("cookie service window is now closed")
                      window.clearInterval(poll);
                      resolve();
                  }
              }, 500);

          });
        }

        function asArray(obj) {
          if(obj) {
            return (obj.constructor === Array ? obj : [obj]);
          }
          return [];
        }
        function first(objOrArray, predicate) {
          let arr = asArray(objOrArray);
          let filtered = arr.filter(predicate);
          if (filtered.length > 0) {
            return filtered[0];
          }
          return null;
        }
        function getOrigin(url) {
          let urlHolder = window.location;
          if(url){
              urlHolder = document.createElement('a');
              urlHolder.href = url;
          }
          return urlHolder.protocol + "//" + urlHolder.hostname + (urlHolder.port ? ':' + urlHolder.port: '');
        }
        

        async function loadImage(imageServiceId, token){
          let infoResponse;
          try{
            infoResponse = await loadInfo(imageServiceId, token);
          } catch (e) {
            console.log("Could not load " + imageServiceId);
            console.log(e);
          }
          if(infoResponse && infoResponse.status === 200){
              renderImage(infoResponse.info);
              if(infoResponse.info["@id"] != imageServiceId){
                  console.log("The requested imageService is " + imageServiceId);
                  console.log("The @id returned is " + infoResponse.info["@id"]);
                  console.log("This image is most likely the degraded version of the one you asked for")
                  infoResponse.degraded = true;
              }
          }
          return infoResponse;
        }


        async function attemptWithToken(authService, imageService) {
          console.log("Attempting token interaction for " + data.authServiceID);
          // let tokenService = first(authService.service, s => s.profile === PROFILE_TOKEN);
          // console.log(authService);
          let tokenService1 = asArray(authService).some(s => s.service === PROFILE_TOKEN);
          let tokenService = JSON.parse(authService).filter(s => s.service);
          let tokenSort = asArray(tokenService).some(s => s.service[0].profile === PROFILE_TOKEN);
          // console.log(tokenSort);
          if (tokenSort) {
            let tokenId = JSON.parse(authService).map(s => s.service[0]["@id"]);
            console.log("Token service found: " + tokenId[0]);
            let tokenMessage = await openTokenService(tokenId[0]); 
            if(tokenMessage && tokenMessage.accessToken) {
              let withTokenInfoResponse = await loadImage(imageService, tokenMessage.accessToken); 
              console.log("Info request with token resulted in " + withTokenInfoResponse.status);
              if(withTokenInfoResponse.status == 200) {
                console.log("token response 200");
                renderImage(withTokenInfoResponse.info); 
                return true;
              }
            }
          }
          console.log("Did not get a 200 response...");
          return false;
        }

        async function authChain() {
          if(!data.authService) {
            alert("No services found!");
            return;
          }
          console.log("Services found in: " + info);

          let services = asArray(dataServices);
          
          let lastAttempted = null;
          let requestedId = data.authServiceID;
          let serviceToLoad = JSON.parse(dataServices);

          console.log("Looking for external pattern...");
          let serviceToTry = asArray(serviceToLoad).some(s => s.profile === PROFILE_EXTERNAL);
          if (serviceToTry) {
            console.log("External Pattern found");
            lastAttempted = asArray(serviceToLoad).filter(s => s.profile === PROFILE_EXTERNAL);
            // let tokenId = JSON.parse(dataServices).map(s => s["@id"]);
            // tokenId = tokenId.toString().replace(/,+$/, "");
            let success = await attemptWithToken(dataServices, requestedId);
            if (success) return;
          }
          

          console.log("Looking for kiosk pattern...");
          serviceToTry = asArray(serviceToLoad).some(s => s.profile === PROFILE_KIOSK);
          if (serviceToTry) {
            console.log("Kiosk Pattern found");
            lastAttempted = asArray(serviceToLoad).filter(s => s.profile === PROFILE_EXTERNAL);
            let tokenId = JSON.parse(dataServices).map(s => s["@id"]);
            tokenId = tokenId.toString().replace(/,+$/, "");

            let kioskWindow = openContentProviderWindow(tokenId);
            if (kioskWindow) {
              await userInteractionWithContentProvider(kioskWindow);
              let success = await attemptWithToken(dataServices, requestedId);
              if (success) return;
            } else {
              alert("Could not open kiosk window, please enable pop-ups.");
            }
          }

          console.log("Looking for clickthrough pattern...");
          serviceToTry = asArray(serviceToLoad).some(s => s.profile === PROFILE_CLICKTHROUGH);
          if (serviceToTry) {
            console.log("Clickthrough Pattern found");
            lastAttempted = asArray(serviceToLoad).filter(s => s.profile === PROFILE_EXTERNAL);
            let tokenId = JSON.parse(dataServices).map(s => s["@id"]);
            tokenId = tokenId.toString().replace(/,+$/, "");

            let contentProviderWindow = openContentProviderWindow(tokenId);
            if (contentProviderWindow) {
              await userInteractionWithContentProvider(contentProviderWindow); 
              let success = await attemptWithToken(dataServices, requestedId);
              if (success) return;
            }
          }

          console.log("Looking for login pattern...");
          serviceToTry = asArray(serviceToLoad).some(s => s.profile === PROFILE_LOGIN);
          if (serviceToTry) {
            console.log("Login Pattern found");
            lastAttempted = asArray(serviceToLoad).filter(s => s.profile === PROFILE_EXTERNAL);
            let tokenId = JSON.parse(dataServices).map(s => s["@id"]);
            tokenId = tokenId.toString().replace(/,+$/, "");
            
            let contentProviderWindow = openContentProviderWindow(tokenId);
            if (contentProviderWindow) {
              await userInteractionWithContentProvider(contentProviderWindow); 
              let success = await attemptWithToken(dataServices, requestedId);
              if (success) return;
            }
          }

          console.log("Auth service unable to authenticate - loading thumbnail version");
        }

        function* MessageIdGenerator(){
          var messageId = 1; // don't start at 0, it's falsey
          while(true) yield messageId++;
        }
        var messageIds = MessageIdGenerator();

        function openTokenService(tokenService) {
          // use a Promise across a postMessage call
          return new Promise((resolve, reject) => {
            // if necessary, the client can decide not to trust this origin
            const serviceOrigin = getOrigin(data.authServiceID);
            const messageId = messageIds.next().value;
            messages[messageId] = { 
                "resolve": resolve,
                "reject": reject,
                "serviceOrigin": serviceOrigin
            };
            var tokenUrl = tokenService + "?messageId=" + messageId + "&origin=" + getOrigin(); 
            // console.log(tokenUrl);
            document.getElementById("commsFrame").src = tokenUrl;

            // reject any unhandled messages after a configurable timeout
            const postMessageTimeout = 5000;
            setTimeout(() => {
                if(messages[messageId]){
                    messages[messageId].reject(
                        "Message unhandled after " + postMessageTimeout + "ms, rejecting");
                    delete messages[messageId];
                }
            }, postMessageTimeout);
          });
        }

        window.addEventListener("message", receiveMessage, false);
        // The event listener for postMessage. Needs to take care it only
        // responds to messages initiated by openTokenService(..)
        // Completes promises made in openTokenService(..)
        function receiveMessage(event) { 
            // console.log(JSON.stringify(event.data));
            console.log("event received, origin=" + event.origin);
            let rejectValue = "postMessage event received but rejected.";
            if(event.data.hasOwnProperty("messageId")){
                console.log("recieved message with id " + event.data.messageId);
                var message = messages[event.data.messageId];
                if(message && event.origin == message.serviceOrigin)
                {
                    // Any message with a messageId is a success
                    console.log("We trust that we triggered this message, so resolve")
                    message.resolve(event.data);
                    delete messages[event.data.messageId];
                    return;
                }    
            }
        }

        //


        function renderImage(info){
          
          // Mirador.BookView.prototype.updateImage(data.canvasID);
          Login.currentImage();
          console.log("Re-load " + info["@id"]);
          // imagePromise = Mirador.createImagePromise(info["@id"]);
          // Mirador.debounce(function(){
          //   this.loadImages();
          // }, 100);

          // old OSD code from iiif-auth-client
          // if(viewer){
          //     viewer.destroy();
          //     viewer = null;
          // }
          // viewer = OpenSeadragon({
          //     id: "viewer",
          //     prefixUrl: "openseadragon/images/",
          //     tileSources: info
          // });
        }
      }.bind(this));
      origFunc.apply(this);
    };
  },

  currentImage: function(){
    Mirador.Workspace.prototype.bindEvents = function(){
      this.eventEmitter.publish(
        'SET_CURRENT_CANVAS_ID.' + this.windowId, this.imagesList[0]['@id']
      );
    }
  },

  /* adds the locales to the internationalization module of the viewer */
  addLocalesToViewer: function(){
    for(var language in this.locales){
      i18next.addResources(
        language, 'translation',
        this.locales[language]
      );
    }
  },

  handleSetBounds: function() {
    var _this = this;
    this.osdOptions.osdBounds = this.osd.viewport.getBounds(true);
    _this.eventEmitter.publish("imageBoundsUpdated", {
      id: _this.windowId,
        osdBounds: {
          x: _this.osdOptions.osdBounds.x,
          y: _this.osdOptions.osdBounds.y,
          width: _this.osdOptions.osdBounds.width,
          height: _this.osdOptions.osdBounds.height
        }
    });
  },

  // Overwrite of toggleFocus of Mirador.Window.prototype.toggleFocus to add authService ids & profiles for authChain
  toggleFocus: function(focusState, imageMode) {
    var _this = this;

    this.viewType = focusState;
    if (imageMode && jQuery.inArray(imageMode, this.imageModes) > -1) {
      this.currentImageMode = imageMode;
    }
    //set other focusStates to false (toggle to display none)
    jQuery.each(this.focusModules, function(focusKey, module) {
      if (module && focusState !== focusKey) {
        module.toggle(false);
      }
    });
    this.focusModules[focusState].toggle(true);
    this.updateManifestInfo();
    this.updatePanelsAndOverlay(focusState);
    this.updateSidePanel();
    // _this.eventEmitter.publish('SET_CURRENT_CANVAS_ID.' + windowId);
    _this.eventEmitter.publish("focusUpdated");
    _this.eventEmitter.publish("windowUpdated", {
      id: _this.id,
      viewType: _this.viewType,
      canvasID: _this.canvasID,
      imageMode: _this.currentImageMode,
      loadedManifest: _this.manifest.jsonLd['@id'],
      slotAddress: _this.slotAddress,
      authService: _this.imagesList[Mirador.getImageIndexById(_this.imagesList, _this.canvasID)].images[0].resource.service,
      authServiceID: _this.imagesList[Mirador.getImageIndexById(_this.imagesList, _this.canvasID)].images[0].resource.service['@id'],
      authServiceProfile: _this.imagesList[Mirador.getImageIndexById(_this.imagesList, _this.canvasID)].images[0].resource.service.profile
    });
  }
}

$(document).ready(function(){
  Login.init();
});