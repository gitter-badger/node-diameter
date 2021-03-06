'use strict';

var _ = require('lodash');
var DiameterCodec = require('./diameter-codec').DiameterCodec;
var diameterUtil = require('./diameter-util');
var Q = require('q');


var DIAMETER_MESSAGE_HEADER_LENGTH_IN_BYTES = 20;


function DiameterSession(options, socket) {
    if (!(this instanceof DiameterSession)) {
        return new DiameterSession();
    }    
    var self = this;
    self.socket = socket;
    self.options = options;
    self.pendingRequests = {};
    self.hopByHopIdCounter = diameterUtil.random32BitNumber();
    self.diameterCodec = new DiameterCodec(options.dictionary);

    var buffer = new Buffer(0, 'hex');

    self.socket.on('data', function(data) {
        buffer = Buffer.concat([buffer, new Buffer(data, 'hex')]);

        // If we collected header
        if (buffer.length >= DIAMETER_MESSAGE_HEADER_LENGTH_IN_BYTES) {
            var messageLength = self.diameterCodec.decodeMessageHeader(buffer).header.length;

            // If we collected the entire message
            if (buffer.length >= messageLength) {
                var message = self.diameterCodec.decodeMessage(buffer);

                if (message.header.flags.request) {
                    var response = self.diameterCodec.constructResponse(message);
                    
                    if (_.isFunction(self.options.beforeAnyMessage)) {
                        self.options.beforeAnyMessage(message);
                    }

                    self.socket.emit('diameterMessage', {
                        message: message,
                        response: response,
                        callback: function(response) {
                            if (_.isFunction(self.options.afterAnyMessage)) {
                                self.options.afterAnyMessage(response);
                            }
                            var responseBuffer = self.diameterCodec.encodeMessage(response);
                            self.socket.write(responseBuffer);     
                        }
                    });
                } else {
                    var pendingRequest = self.pendingRequests[message.hopByHopId];
                    if (pendingRequest != null) {
                        if (_.isFunction(self.options.afterAnyMessage)) {
                            self.options.afterAnyMessage(message);
                        }
                        self.pendingRequests[message.hopByHopId] = undefined;
                        pendingRequest.deferred.resolve(message);
                    } else {
                        // handle this
                    }
                }
                buffer = buffer.slice(messageLength);
            }
        } 
    });
    
    self.createRequest = function(application, command) {
        return self.diameterCodec.constructRequest(application, command, this.options.sessionId);
    };
    
    self.sendRequest = function(request, timeout) {
        var deferred = Q.defer();
        if (this.socket === undefined) {
            deferred.reject('Socket not bound to session.');
            return deferred.promise;
        }
        timeout = timeout || this.options.timeout || 3000;
        request.header.hopByHopId = this.hopByHopIdCounter++;
        if (_.isFunction(this.options.beforeAnyMessage)) {
            this.options.beforeAnyMessage(request);
        }
        var requestBuffer = self.diameterCodec.encodeMessage(request);
        this.socket.write(requestBuffer);
        var promise = Q.timeout(deferred.promise, timeout, 'Request timed out, no response was received in ' + timeout + 'ms');
        this.pendingRequests[request.hopByHopId] = {
            'request': request,
            'deferred': deferred
        };
        return promise;
    };
}

exports.DiameterSession = DiameterSession;
