// Auth Profiles
const PROFILE_LOGIN = 'http://iiif.io/api/auth/1/login';
const PROFILE_CLICKTHROUGH = 'http://iiif.io/api/auth/1/clickthrough';
const PROFILE_KIOSK = 'http://iiif.io/api/auth/1/kiosk';
const PROFILE_EXTERNAL = 'http://iiif.io/api/auth/1/external';
const PROFILE_TOKEN = 'http://iiif.io/api/auth/1/token';
const PROFILE_LOGOUT = 'http://iiif.io/api/auth/1/logout';

let viewer = null;   
let messages = {};

let dataServices = "";


// Mirador plugin
let Login = {
  /* initializes the plugin */
  init: function(){
    this.injectWorkspaceEventHandler();
    console.log("Initializing Auth...");
  },

  /* injects the needed workspace event handler */
  injectWorkspaceEventHandler: function(){
    let this_ = this;

    let origFunc = Mirador.Workspace.prototype.bindEvents;

    Mirador.Workspace.prototype.bindEvents = function(){
      let workspace = this;
      this.eventEmitter.subscribe('windowUpdated', function(event, data){
        if(!data.loadedManifest){
          return;
        }

        // let info = data.authService["@id"] + "/info.json";
        let info = data.canvases[data.canvasID].images[0].tileSource;
        let reqId = data.canvases[data.canvasID].images[0].tileSource;
        let requestedId = reqId.replace('/info.json', '');

        let dataService = $.ajax({
              url: info,
              dataType: 'json'
            })
            .done(function(data) {
              dataServices = data.service;
              console.log("info.json found");
              authChain();
            })
            .fail(function(data) {
              console.log("Data not found in " + JSON.stringify(data.service));
              console.log("Info.json not loaded.  Auth unable to initialize.");
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
            request.onerror = function() {
                reject(this.status + " " + this.statusText);
            };        
            request.send();
          });
        }

        function openContentProviderWindow(service){
          let cookieServiceUrl = service["@id"] + "?origin=" + getOrigin();
          console.log("Opening content provider window: " + cookieServiceUrl);
          if (!window.open(cookieServiceUrl)) {
            alert('Cookie failed to open, please allow pop-ups to generate cookie');
          } else {
            return;
          }
        }

        function userInteractionWithContentProvider(contentProviderWindow){
          return new Promise((resolve) => {
              // What happens here is forever a mystery to a client application.
              // It can but wait.
              let poll = window.setInterval(() => {
                  if(contentProviderWindow.closed){
                      console.log("cookie service window is now closed");
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
                  console.log("This image is most likely the degraded version of the one you asked for");
                  infoResponse.degraded = true;
              }
          }
          return infoResponse;
        }

        async function attemptWithToken(authService, imageService) {
          console.log("Attempting token interaction for " + authService["@id"]);
          let tokenService = first(authService.service, s => s.profile === PROFILE_TOKEN);
          if (tokenService) {
            console.log("Token service found: " + tokenService["@id"]);
            let tokenMessage = await openTokenService(tokenService["@id"]); 
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
          if(!dataServices) {
            alert("No services found!");
            return;
          }
          console.log("Services found in: " + info);

          let services = asArray(dataServices);
          let lastAttempted = null;
          // console.log(requestedId);

          console.log("Looking for external pattern...");
          let serviceToTry = first(services, s => s.profile === PROFILE_EXTERNAL);
          if (serviceToTry) {
            console.log("External Pattern found");
            lastAttempted = serviceToTry;
            let success = await attemptWithToken(serviceToTry, requestedId);
            if (success) return;
          }
          

          console.log("Looking for kiosk pattern...");
          serviceToTry = first(services, s => s.profile === PROFILE_KIOSK);
          if (serviceToTry) {
            console.log("Kiosk Pattern found");
            lastAttempted = serviceToTry;
            let kioskWindow = openContentProviderWindow(serviceToTry);
            if (kioskWindow) {
              await userInteractionWithContentProvider(kioskWindow);
              let success = await attemptWithToken(serviceToTry, requestedId);
              if (success) return;
            } else {
              alert("Could not open kiosk window, please enable pop-ups.");
            }
          }

          console.log("Looking for clickthrough pattern...");
          serviceToTry = first(services, s => s.profile === PROFILE_CLICKTHROUGH);
          if (serviceToTry) {
            console.log("Clickthrough Pattern found");
            lastAttempted = serviceToTry;
            let contentProviderWindow = openContentProviderWindow(serviceToTry);
            if (contentProviderWindow) {
              await userInteractionWithContentProvider(contentProviderWindow); 
              let success = await attemptWithToken(serviceToTry, requestedId);
              if (success) return;
            }
          }

          console.log("Looking for login pattern...");
          serviceToTry = first(services, s => s.profile === PROFILE_LOGIN);
          if (serviceToTry) {
            console.log("Login Pattern found");
            lastAttempted = serviceToTry;        
            let contentProviderWindow = openContentProviderWindow(serviceToTry);
            if (contentProviderWindow) {
              await userInteractionWithContentProvider(contentProviderWindow); 
              let success = await attemptWithToken(serviceToTry, requestedId);
              if (success) return;
            }
          }

          console.log("Auth service unable to authenticate - loading thumbnail version");
        }

        function* MessageIdGenerator(){
          let messageId = 1; // don't start at 0, it's falsey
          while(true) yield messageId++;
        }
        let messageIds = MessageIdGenerator();

        function openTokenService(tokenService) {
          // use a Promise across a postMessage call
          return new Promise((resolve, reject) => {
            // if necessary, the client can decide not to trust this origin
            const serviceOrigin = getOrigin(requestedId);
            const messageId = messageIds.next().value;
            messages[messageId] = { 
                "resolve": resolve,
                "reject": reject,
                "serviceOrigin": serviceOrigin
            };
            let tokenUrl = tokenService + "?messageId=" + messageId + "&origin=" + getOrigin(); 
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
                let message = messages[event.data.messageId];
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
        'SET_CURRENT_CANVAS_ID.' + this.windowId, this.imagesList[this.currentImgIndex]['@id']
      );
    }
  },
}

$(document).ready(function(){
  // code from authChain to generate cookie, temp solution to load cookie before images
  function openContentProviderWindow(service){
    let cookieServiceUrl = service + "?origin=" + getOrigin();
    console.log("Opening content provider window: " + cookieServiceUrl);
    if (!window.open(cookieServiceUrl)) {
      alert('Cookie failed to open, please allow pop-ups to generate cookie');
    } else {
      return;
    }
  }
  function getOrigin(url) {
    let urlHolder = window.location;
    if(url){
        urlHolder = document.createElement('a');
        urlHolder.href = url;
    }
    return urlHolder.protocol + "//" + urlHolder.hostname + (urlHolder.port ? ':' + urlHolder.port: '');
  }
  openContentProviderWindow("http://media.getty.edu/auth/login"); 

  Login.init();
});