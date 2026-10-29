angular.module('epsv2App')
.factory('userInformationService',['$http', function($http) {
	return {
		getData: function(successCallback, errorCallback) {
			$http.post(contextPath + '/rest/user/geLoggedInUserDetails')
			.then(successCallback, errorCallback);
		}
	};
}])

.factory('userInformationServiceCreatorDetails',['$http', function($http){
	var factory = {};
	factory.getData = function(userId, successCallback, errorCallback) {
		$http.post(contextPath+"/rest/tender/getTenderOwnerDetails?tenderId="+ userId)
		.then(successCallback, errorCallback);		
	}
	return factory;
}])

.factory('error',['$http',function() {
    return {
        handelError: function(msg,code) {
        	bootbox.alert({ 
			  size: "small",
			  title: "Error",
			  message: msg+" <br />Error Code #"+code, 
			  callback: function(){ /* your callback code */ }
			});
        }
    };
}])
.factory('initGeneralInfoFormService',['$http', function($http){
	var factory = {};
	factory.getData = function(successCallback, errorCallback) {
		var promise = $http.post(contextPath + '/rest/tender/getMasterTemplate');
		return promise;
	}
	return factory;
}])
/*.factory('templateShortNameService', function($http){
	return {
		get: function(successCallback, errorCallback) {
			$http.get(contextPath + '/rest/tender/getTemplateShortNames')
			.then(successCallback, errorCallback);
		}
	};
})*/
.factory('tenderService', function($http, $q){
	return {
		createTender : function(generalInformationFormData) {
			var deferred = $q.defer();
			 $http.post(contextPath + '/rest/tender/insertTender', generalInformationFormData).then(function(response) {
	        	deferred.resolve(response);
	        }, function(err) {
	        	console.log(err.headers('errorMsg'));
	            return deferred.reject(err);
	        });
	        return deferred.promise;			
		},
		getTabs : function(tenderId, userRoleId, successCallback, errorCallback){
			var data = {
				tenderId:tenderId,
				userRoleId: userRoleId
			}
			var promise = $http({
				url: contextPath + '/rest/tender/getTender', 
				method: "POST",
				//headers: { 'Content-Type': 'application/json; charset=utf-8', 'params': JSON.stringify(data) }
				params: data
			});		
			promise.then(successCallback, errorCallback);
			return promise;
		}  ,
		
		getApprovalDetails : function(id,successCallback, errorCallback){			
			var promise = $http({
				url: workflowUrl + '/rest/workflow/getApprovalDetailsByDocTypeAndUserId?docTypeId='+id,
				method: "POST"				
			});		
			promise.then(successCallback, errorCallback);
			return promise;
		},
		
	/***************************			PKI SERVICES START HERE 			*****************************/
		
		getTenderHashString: function(tenderId){
			//alert(quotationId+" hi");
			var url = contextPath + '/rest/tender/getTenderHashString?tenderId='+tenderId;
			return $http.post(url);
		},
		
		saveTenderSignHash: function(data){
			var url = contextPath + '/rest/tender/saveTenderSignHash';
			return $http.post(url, data);
		},
		
		getTenderInfoById: function(tenderId){
			//alert(quotationId+" hi");
			var url = contextPath +'/rest/tender/previewTenderByTenderId?tenderId='+tenderId;
			return $http.post(url);
		},
		
		// get tender details
		getTenderDetails: function(tenderId){
			var url=contextPathWorkflow+'/rest/revisedandimpactbid/getRevImpBidDetailsForRevAndImp?tenderId='+tenderId;
			var promise	= $http.post(url);								
			return promise;
		},
		
		// get final open tender
		getFinalOpenForTender: function(tenderId, bidPartNo){
			var url=contextPath+'/rest/tender/getFinalOpenerForTender?tenderId='+tenderId+'&bidPartNo='+bidPartNo;
			var promise	= $http.post(url);								
			return promise;
		},
		
		// get  Encryption Key List for Quotations 
		getEncryptionKeyListQuotation: function(tenderId, bidPartNo){
			var url=contextPath+'/rest/tender/getQuotationKeyListPendingWithOpener?tenderId='+tenderId+'&bidPartNo='+bidPartNo;
			var promise	= $http.post(url);								
			return promise;
		},
		// Updating current Encryption Key status and insert next level Decrypted Key
		
		insertdecryptKey : function(data) {
			var url	= contextPath+'/rest/tender/updateExistingStatusAndNextKeyForOpener';
			return $http.post(url, data);
		},
		
		// get offer validity details
		getOfferValidityDetails: function(tenderId){
			var url=contextPath+'/rest/extentOfferValidity/getOfferValidityDetails?tenderId='+tenderId;
			var promise	= $http.post(url);								
			return promise;
		},
		
		// get bidder list for decrypt the bidder 
		getBidderDetailsForDecrypt: function(tenderId){
			var url=contextPath+'/rest/bidactivity/showBidderListByTenderIdForInitiatorNew?tenderId='+tenderId;
			var promise	= $http.post(url);								
			return promise;
		},
		updateTenderAuctionFlag:function(tenderId,flag){
		    var url=contextPath+'/rest/tender/updateTenderAuctionFlag?tenderId='+tenderId+'&flag='+flag;
            var promise	= $http.post(url);
            return promise;
		}
		
	}
})
/*
.factory('tenderService',['$http', function($http){
	var factory = {};
	factory.createTender = function(generalInformationFormData, successCallback, errorCallback) {
		$http.post(contextPath + '/rest/tender/insertTender', generalInformationFormData)
		.then(successCallback, errorCallback);
	}
	factory.getTabs = function(tenderId, userRoleId, successCallback, errorCallback) {
		var data = {
				tenderId:tenderId,
				userRoleId: userRoleId
		}
		var promise = $http({
		    url: contextPath + '/rest/tender/getTender', 
		    method: "POST",
		    //headers: { 'Content-Type': 'application/json; charset=utf-8', 'params': JSON.stringify(data) }
		    params: data
		 });		
		promise.then(successCallback, errorCallback);
		return promise;
	}
	return factory;
}])
*/
.factory('templateFieldService',['$http', function($http) {
	return {
		getData: function(tenderId, templategroupId, approvalId, userRoleId, successCallback, errorCallback) {
			var data = {
					tenderId:tenderId,
					templategroupId: templategroupId,
					approvalId: approvalId,
					userRoleId: userRoleId
			};
			var promise = $http({
			    url: contextPath + '/rest/tender/getTenderDetail', 
			    method: "POST",
			    headers: { 'Content-Type': 'application/json; charset=utf-8', 'params': JSON.stringify(data) }
			 });
			promise.then(successCallback, errorCallback);
			return promise;			
		}
	};
}])
.factory('rfqItemService',['$http', function($http) {
	var factory = {};
	
	factory.getOrganizationList = function(successCallback, errorCallback) {
		$http.post(contextPath + '/rest/master/searchitemparameter', {"orgId": 0, "sorId": 0})
		.then(successCallback, errorCallback);
	};
	
	factory.getSORList = function(orgId, successCallback, errorCallback) {
		$http.post(contextPath + '/rest/master/searchitemparameter', {"orgId": orgId, "sorId": 0})
		.then(successCallback, errorCallback);
	};
	
	factory.getChapterList = function(orgId, sorId, successCallback, errorCallback) {
		$http.post(contextPath + '/rest/master/searchitemparameter', {"orgId": orgId, "sorId": sorId})
		.then(successCallback, errorCallback);
	};
	
	
	/*
	 * Getting Item Search Results
	 */
	factory.itemSearchResults = function(searchParams, successCallback, errorCallback) {
		$http.post(contextPath + '/rest/master/findItem', searchParams)
		.then(successCallback, errorCallback);
	};
	
	return factory;
}])
.factory('previewTenderService',['$http', function($http) {
	return {
		getData: function(tenderId, successCallback, errorCallback) {
			$http.post(contextPath + '/rest/tender/previewTenderByTenderId?tenderId='+tenderId)
			.then(successCallback, errorCallback);
		},
		getTenderIdOfParent: function(tenderId,successCallback, errorCallback){
			$http.post(contextPath + '/rest/tender/getParentId?tenderId='+tenderId)
			.then(successCallback, errorCallback);
		},
		getNotRequiredRemarkAndAttchFile: function(tenderId,successCallback, errorCallback){
			$http.post(contextPath + '/rest/approval/getNotRequiredDetails?documentId='+tenderId)
			.then(successCallback, errorCallback);
		}
	};
}])

.factory('bidOpeningStatusService',['$http',function($http){
	return{
		getData: function(tenderId,successCallback, errorCallback){
			$http.post(contextPath + '/rest/tender/processInitiationStatus?tenderId='+tenderId)
			.then(successCallback, errorCallback);
		},
		
		getOtherData: function(tenderId,successCallback, errorCallback){
			$http.post(contextPath + '/rest/tender/processInitiationStatusForOtherTenders?tenderId='+tenderId)
			.then(successCallback, errorCallback);
		},
		getActiveBidOpener: function(tenderId,bidPartNo,successCallback, errorCallback){
			$http.post(contextPath + '/rest/tender/getActiveBidOpener?tenderId='+tenderId+'&bidPartNo='+bidPartNo)
			.then(successCallback, errorCallback);
		},
		switchTenderBidOpenerIsActiveStatus: function(tenderId,bidPartNo,successCallback, errorCallback){
			$http.post(contextPath + '/rest/tender/switchTenderBidOpenerIsActiveStatus?tenderId='+tenderId+'&bidPartNo='+bidPartNo)
			.then(successCallback, errorCallback);
		}
		
		
	};
	
}])

.factory('cancelTenderStatusService',['$http',function($http){
	return{
		getData: function(tenderId,successCallback, errorCallback){
			$http.post(contextPath + '/rest/canceltender/cancelTenderStatus?tenderId='+tenderId)
			.then(successCallback, errorCallback);
		}
		
	};
	
	
}])

.service('bidPreviewService', function(utilityService) {
		var _templateList = [];
		var _previewData = {};
		var _fixedTemplates = {};
		var _templateGroupIdMap = {};		
		
		var _createNColumnFieldList = function(fieldList, n) {
			var newList = [],
			    counter = 0;
			for(var i = 0; i < Math.ceil(fieldList.length/n); ++i) {
				newList[i] = [];
				for(var j = 0; j < n; ++j) {
					if(fieldList[counter])
						newList[i][j] = fieldList[counter++];
				}
			}			
			return newList;
		};
		
		var _buildPreview = function() {
			angular.forEach(_templateList, function(template) {
				
				if(template['shortName'] == _fixedTemplates.payment) {
					template['preview'] = {};
					var feesHistory = {};
					feesHistory["exemption"] = [];
					feesHistory["nonExemption"] = [];
					if(typeof _previewData.quotationFeesList != 'undefined' && _previewData.quotationFeesList instanceof Array) {
						for(var i = 0; i < _previewData.quotationFeesList.length; ++i) {
							var value = _previewData.quotationFeesList[i];
							if(value.quotationpaymentmode == 'Exemption')
								feesHistory["exemption"].push(angular.copy(value));
							else
								feesHistory["nonExemption"].push(angular.copy(value));
						}
					}					
					template['preview']["data"] 	= _previewData.quotationFeesMasterList;
					template['preview']["history"] 	= feesHistory;
					template['preview']['description']    = template.description;
				} else if(template['shortName'] == _fixedTemplates.attachment) {
					template['preview'] = {};
					template['preview']['data'] = angular.copy(_previewData.quotAttachListMap);
					template['preview']['description']    = template.description;
				} else {
					template['preview'] = {};
					var newData = _.where(_previewData.templates, { shortName: template.shortName });
					template["preview"]['data'] = [] ;

//					For Setting excel_bidding field value to comma separated template long name instead of comma separated template group ids... 
					if(template["shortName"] == 'quot_gen_info' && template["preview"]['displayLayoutid'] != 102 && typeof newData[0] != 'undefined' && newData[0].templateFieldList instanceof Array) {
						for(var i = 0; i < newData[0].templateFieldList.length; ++i) {
							var field = newData[0].templateFieldList[i];
							if(field.shortName == 'excel_bidding' && typeof field.value == 'string') {
								var values = [];
								angular.forEach(field.value.split(','), function(val) {
									if(typeof _templateGroupIdMap[val] !== 'undefined')
										values.push(_templateGroupIdMap[val]);
								});
								newData[0].templateFieldList[i].value = values.join(', ');
								break;
							}
						}
					}
					if(newData != undefined && newData.length > 0) {					
						template["preview"]['data'].push(newData[0]);
						switch(template['displayLayoutid']) {
							case 101:
								template["preview"]['data'][0].templateFieldList = _createNColumnFieldList(newData[0].templateFieldList, 2);
								break;
							case 103:
							case 104:
								template["preview"]['data'][0].templateFieldList = _createNColumnFieldList(newData[0].templateFieldList, 4);
								break;
							case 105:
								template["preview"]['data'][0].templateFieldList = _createNColumnFieldList(newData[0].templateFieldList, 3);
								break;	
							default:
								template["preview"]['data'] = newData;
								if(template["preview"]['data'] instanceof Array && template["preview"]['data'].length > 1) {
									// ITEM SORT
									if((template["preview"]['data'] != null && template["preview"]['data'].length != 0) && template["preview"]['data'][0].templateTypeId == 102){
										var parent = _.filter(template["preview"]['data'], {itemParentCode: '0'});
										parent = parent.sort(function(a,b){
											return(parseInt(b.indexSerialNo) - parseInt(a.indexSerialNo));
										});
										template["preview"]['data'] = utilityService.sortRfqItems(template["preview"]['data']);
									}else{
										template["preview"]['data'].sort(function(a, b) {
											return (parseInt(a.indexSerialNo) - parseInt(b.indexSerialNo));
										});
									}									
								}
								break;
						}
					}
					template["preview"]['templateTypeId'] = template.templateTypeId;
					template['preview']['description']    = template.description;
					
					
				}
				
			});
			return _templateList;
		};
		return {
			setTemplateList: function(templateList) {
				_templateList = templateList;
				angular.forEach(_templateList, function(val) {
					_templateGroupIdMap[val.templategroupId] = val.description;
				});
				return this;
			},
			setPreviewData: function(previewData) {
				_previewData = previewData;
				return this;
			},
			setFixedTemplates: function(fixedTemplates) {
				_fixedTemplates = fixedTemplates;
				return this;
			},
			buildPreview: _buildPreview
		};
});
