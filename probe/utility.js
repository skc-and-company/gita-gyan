(function() {
	"use strict";
	angular.module('utility', [])	
	.factory('authHttpResponseInterceptor',['$q',function($q){
		return {
			response: function(response){//alert("Success"+response);
				if (response.status === 1000 || response.status == 2000) {
					console.log("Token Expired");
				}
				return response || $q.when(response);
			},
			responseError: function(rejection) {//console.log(rejection);
				if (rejection.status === 1000 || rejection.status === 1001 || rejection.status == 2000 ) {
					
					var msg;
					if( rejection.status == 2000 ){
						msg = "Missing or invalid Authorization header.";
					}else if( rejection.status == 1000 ){
						msg = "Invalid Token.";
					}else if( rejection.status == 1001 ){
						msg = "Inactive Error.";
					}
					document.getElementById('pageNavigateForm').action=contextPath;
					document.getElementById('pageNavigateForm').submit();
				}
				return $q.reject(rejection);
			},
			request: function (config) {
				if(angular.isUndefined(config.allowAuth)|| !config.allowAuth){
					config.headers['Authorization'] = $('#Authorization').val();
				}
				return config;
			}
		}
	}])
	.filter('trustHtml',function($sce){
	  return function(html){
		  if(null != html && html != '')
		    return $sce.trustAsHtml(html.toString());
		  };
		})
	.filter('spaceRemover',function(){
	  return function(string){
		   var stringArr = string.split(' ');
		   return stringArr.join('');
		  };
		})
	.filter("toArray", function(){
	return function(data)
	{
		var newRes = [];
		angular.forEach(data,function(val,key){
			val["id"] = key;
			newRes.push(val);
		});
		return newRes;
	}
})
.filter("globalTextFilterForDocumentTracking", function($filter){
	return function(data,text,documentType)
	{
		var tempReturnData=[];
		if(text!="" && text!=null){
			var temp1=[];
			var temp2=[];
			var temp3=[];
			var temp4=[];
			var temp5=[];
			var instrumentTypeException=documentType=='1' ? "instrumentTypeId" : "instrumentType";
			text=text.toLowerCase();
			var tempCustomVariable;
			for(var i=0;i<data.length;i++){
				//
				var tempArray=["orgDocId",instrumentTypeException,"vendorName","description","instrumentNo"];
				for(var j=0;j<tempArray.length;j++){
					var tempVarName=tempArray[j];
					if(tempVarName=="instrumentTypeId")
					{
						tempCustomVariable=data[i]["code"];
					}else
					{
						tempCustomVariable=data[i][tempVarName];
					}
					if(tempCustomVariable!=undefined && tempCustomVariable!=null){
					tempCustomVariable=tempCustomVariable.toString();
					
					}
					if(tempCustomVariable!=undefined && tempArray[j]!="orgDocId"){
					tempCustomVariable=tempCustomVariable.toLowerCase();
					}
					if(tempCustomVariable!=undefined && tempCustomVariable.indexOf(text)>-1){
						//forbase document number	
						if(tempVarName=="orgDocId")
						{
							temp1.push(data[i]);

						}
						//forbase document number
						//for instrument type
						else if(tempVarName==instrumentTypeException){
							temp2.push(data[i]);

						}
						//for instrument type
						//for vendor name
						else if(tempVarName=="vendorName"){
							temp3.push(data[i]);

						}
						//for vendor name
						//for description
						else if(tempVarName=="description"){
							temp4.push(data[i]);

						}
						//for description
						
						//for instrumentNo
						else if(tempVarName=="instrumentNo"){
							temp5.push(data[i]);
						}
						//for instrumentNo
					}
					
					//inner loop
				}
							
				//outer loop
			}
			if(temp1.length>0){		
				for(var m=0;m<temp1.length;m++){
					tempReturnData.push(temp1[m]);
				}
			}
			if(temp2.length>0){				
				for(var n=0;n<temp2.length;n++){
					tempReturnData.push(temp2[n]);
				}
			}
			if(temp3.length>0){				
				for(var o=0;o<temp3.length;o++){
					tempReturnData.push(temp3[o]);
				}
			}
			if(temp4.length>0){				
				for(var p=0;p<temp4.length;p++){
					tempReturnData.push(temp4[p]);
				}
			}
			if(temp5.length>0){				
				for(var q=0;q<temp5.length;q++){
					tempReturnData.push(temp5[q]);
				}
			}
			//for unique creation			
			tempReturnData=tempReturnData.reduce(function(acc, el, i, arr) {			 
				    var tempObject=[];
				    if(el!=undefined){
				    	if(documentType=='1'){
				    		tempObject=$filter('filter')(acc,{documentTrackingId:el.documentTrackingId});
				    	}else{
				    		tempObject=$filter('filter')(acc,{documentPendingId:el.documentPendingId});
				    	}
				    	if(tempObject.length==0 || tempObject==undefined){
				    		acc.push(el);
				    	}
				    }
					return acc;
			 }, []);	 
			//for unique creation
			
		}else{
			tempReturnData=data;
		}
		//console.log(data)
		return tempReturnData;
	}
})

//for po view aggregation
.filter('calculateSum', function($filter){	
	return function(input, obj){
		var total=0;		
		var showType="sum";	
		var dataformatVal ="";
		if(input.isAggregation=='Y'){			
			for(var i=0;i<obj.length;i++){
				if(obj[i].hasOwnProperty("templateFieldList")){
					for(var j=0;j<obj[i].templateFieldList.length;j++){
						if(input.code==obj[i].templateFieldList[j].code && obj[i].hasOwnProperty("itemParentCode")){
							if(obj[i].itemParentCode=="0" || obj[i].itemParentCode == null){
								if(obj[i].templateFieldList[j].value!=null){
								total+=parseFloat(obj[i].templateFieldList[j].value);
								}
								if(obj[i].templateFieldList[j].aggregationtypeid==101)
								{
									showType="avg";
								}
								
							    dataformatVal = obj[i].templateFieldList[j].dataFormat;
								
							}
						}
					}
				}
			}
			if(Number.isNaN(total))
			{
				total=0;
			}
			var count=0;

			if(total!=0){
				if(showType=="avg"){
					for(var k=0;k<obj.length;k++){
						if(obj[k].hasOwnProperty("itemParentCode") && obj[k].itemParentCode=="0"){
							count++;
						}
					}
					var len=(obj.length)-1;
					total=(total)/count;
				}
				if(Number.isInteger(total) == false){
					if(dataformatVal != "" && dataformatVal != null && dataformatVal != undefined){
						var datalenn = dataformatVal.split('.');
						var lengthData = datalenn[1].length;
						return total=$filter('number')(total,lengthData);
					}else{
						return total=$filter('number')(total,2);
					}
					
				}else{
					return total;
				}
				
			}else{
				return input.value; 
			}
		}

	}
})
.filter('containsAggregation', function($filter){	
	return function(list){
		var temp=false;
		var tempArr=[];
		if(angular.isArray(list)){
		if(list!=undefined && list!=false){
			tempArr=$filter('filter')(list,{isAggregation:'Y'});
			if(tempArr.length>0)
			{
				temp=true;
			}
			return temp;
		}
		}
	}
})
//for po view aggregation
.filter('htmlIdFromString', function() {
		return function(str) {
			if(str != undefined && str != '')
				return str.split(/[\s]+/).join('_');
			else
				return '';
		};
	})
	//Convert amount in Words 
	.filter('convertInWords', function() {
		return function(value) {
			var newArr = [];
			var newWordsText = "";
			var f_text  = "";
			if(value != null){
				if(isNaN(value)){
					value = value;
				}else{
					value = value.toString();
				}
			}else{
				value = value;
			}
			
			if(value != undefined && value!= NaN &&  value != null && value != ""){
				if (value.indexOf(',') > -1) { 
					value = value.replace (/,/g, "");
				}else{
					value = value;
				}
				if (value.indexOf('.') > -1)
				{
				  newArr = value.split(".");
				  if(newArr.length == 2){
				    if(newArr[1] != ""){
						f_text = "POINT"+convert_frac_number(newArr[1]);
						var amountinwordVal = convert_number(newArr[0])+" "+f_text;
						var lowercaseval = amountinwordVal.toLowerCase();
						var firstLettercapsVal = lowercaseval.charAt(0).toUpperCase() + lowercaseval.slice(1);
						return firstLettercapsVal;
						//return convert_number(newArr[0])+" "+f_text;
					}else{
						//return convert_number(value)+" "+f_text;
						var amountinwordVal = convert_number(value)+" "+f_text;
						var lowercaseval = amountinwordVal.toLowerCase();
						var firstLettercapsVal = lowercaseval.charAt(0).toUpperCase() + lowercaseval.slice(1);
						return firstLettercapsVal;
					}
				  }else{
					  return "Please enter a valid amount here";
				  }
				}else{
					if(value > 0){
						//return convert_number(value)+" "+f_text;
						var amountinwordVal = convert_number(value)+" "+f_text;
						var lowercaseval = amountinwordVal.toLowerCase();
						var firstLettercapsVal = lowercaseval.charAt(0).toUpperCase() + lowercaseval.slice(1);
						return firstLettercapsVal;
					}else{
						return f_text;
					}
				}
			}
			
		}
	})
	.directive('onlyNumbers', function () {
	    return  {
	        restrict: 'A',
	        link: function (scope, elm, attrs, ctrl) {
	            elm.on('keydown', function (event) {
	                if(event.shiftKey){event.preventDefault(); return false;}
	                //console.log(event.which);
	                if ([8, 13, 27, 37, 38, 39, 40].indexOf(event.which) > -1) {
	                    // backspace, enter, escape, arrows
	                    return true;
	                } else if (event.which >= 48 && event.which <= 57) {
	                    // numbers
	                    return true;
	                } else if (event.which >= 96 && event.which <= 105) {
	                    // numpad number
	                    return true;
	                } 
	                // else if ([110, 190].indexOf(event.which) > -1) {
	                //     // dot and numpad dot
	                //     return true;
	                // }
	                else {
	                    event.preventDefault();
	                    return false;
	                }
	            });
	        }
	    }
	})
	.config(['$httpProvider',function($httpProvider) {
		//Http Intercpetor to check auth failures for xhr requests
		$httpProvider.interceptors.push('authHttpResponseInterceptor');
	}])
	.service('RestAPI',function($q, $http){
	    var that=this;
	    this.getAPI=function(url){
	    	console.log('### METHOD= GET, URL='+url);
	        var q = $q.defer();
	        $http({
	            method: 'GET',
	            url: url,
	            data: {}
	        }).then(function (rs) {		
	        	console.log('- RESPONSE: ');
	        	console.log(rs);
	            q.resolve(rs);
	        }, function (err) {		
	            q.reject(err);
	        });
	        return q.promise;
	    }

	    this.postAPI=function(reqObj,url,headers){
	        var url=contextPath+url;
	    	if(headers == undefined){
	    		headers={ 'Content-Type': 'application/json; charset=utf-8'};
	    	}
	        var q = $q.defer();
	        $http({
	            method: 'POST',
	            url: url,
	            headers: headers,
	            data: reqObj
	        }).then(function (rs) {
	            q.resolve(rs);
	        }, function (err) {		
	            q.reject(err);
	        });
	        return q.promise;
	    }
	    
	    
	    this.postAPI_coreModule=function(reqObj,url,headers){
	        var url=parentContextPath+url;
	    	if(headers == undefined){
	    		headers={ 'Content-Type': 'application/json; charset=utf-8'};
	    	}
	        var q = $q.defer();
	        $http({
	            method: 'POST',
	            url: url,
	            headers: headers,
	            data: reqObj
	        }).then(function (rs) {
	            q.resolve(rs);
	        }, function (err) {		
	            q.reject(err);
	        });
	        return q.promise;
	    }

	})
	
	.service('utilityService', function($http, $rootScope, $filter, $timeout, $q, RestAPI) {
		$rootScope.progress = {isBar: false, bar2ProgressVal: 0};
		/*
		 * This function takes file size unit and allowed max file size and return size in byte
		 */
		var verifySignHashScopeHolder; 
		var verifyTenderSignHashScopeHolder;
		var verifyFileSignHashScopeHolder;
		var verifyClarificationDataSignHashScopeHolder;
		var verifyBidEvalDataSignHashScopeHolder;
		var verifyBidderDetailsSignHashScopeHolder;
		var eBriefcaseTag = 'EBRIEFCASE:';
		this.convertFileSizeToByte = function(unit, size){
			if(unit == 'mb'){
				return size * Math.pow(1024, 2);
			}else if(unit == 'kb'){
				return size * 1024;
			}
		};		
		this.getEncryptedKey = function(tenderId, quotationId) {
			var url = contextPath + '/rest/quotation/getEncKey?tenderId='+tenderId+'&quotationId='+quotationId;
			var promise = $http.post(url);			
			return promise;
		};
		this.getEncryptedKeyList = function(tenderId, quotationId) {
			var url = contextPath + '/rest/quotation/getEncKeyList?tenderId='+tenderId+'&quotationId='+quotationId;
			var promise = $http.post(url);			
			return promise;
		};
		this.getBidPartList = function(tenderId){
			var url = contextPath +'/rest/bidactivity/showBidPartListingByTenderId/'+ tenderId;
			var promise = $http.post(url);
			return promise;
		};
		this.getTenderData = function(tenderId) {
			var url = contextPath +'/rest/tender/previewTenderByTenderId?tenderId='+tenderId;
			return $http.post(url);
		};
		this.getTenderDataApproverList = function(tenderId,type) {
			 var approvalId=0;
			 var url = workflowUrl + '/rest/workflow/getApprovalDetailsByDocId?documentId='+tenderId+'&documentType='+parseInt(type)+'&approvalId='+approvalId;
			 return $http.post(url);
		};
		this.getTenderObjForPKIFlag = function(tenderId) {
			var url = contextPath +'/rest/tender/getTender?tenderId='+tenderId+'&userRoleId=0';
			return $http.post(url);
		};
		this.getAttachmentData = function(templateGroupId,tenderId,fileName) {
			var url = contextPath +'/rest/tender/getAttachmentData?tempGrpId='+templateGroupId+'&tenderId='+tenderId+'&fileName='+encodeURIComponent(fileName);
			if(fileName.includes(eBriefcaseTag)){
				url = contextPath +'/rest/ebriefcase/getEbriefcaseHashString?fileName='+encodeURIComponent(fileName);
			}
			return $http.post(url);
		};
		this.getClarificationAttachmentData = function(clarificationId,clarificationMessagesId,fileName,serialNo) {
			var url = contextPath +'/rest/clarification/getAttachmentData?clarificationId='+clarificationId+'&clarificationMessagesId='+clarificationMessagesId+'&fileName='+encodeURIComponent(fileName)+'&serialNo='+serialNo;
			 
			return $http.post(url);
		};

		this.checkBidderExpiry = function() {
            var url = contextPath +'/rest/vendor/checkbidderexpire/';
            return $http.post(url);
        };
		
		this.downloadAttachmentFile = function(url, parameter, method){
			var methodType="";
			switch(method){
				case 'GET':
					methodType=method;
					break;
				case 'POST':
					methodType=method;
					break;
				default:
					methodType="POST";
			}
			var action = url + ".action";
			
			 
			var $form = $('<form>', {  action: action, method: methodType, target: '_blank' });
			$form.append($('<input>', { type: 'hidden', name: 'Authorization', value: $('#Authorization').val() }));
			angular.forEach(parameter, function(value, key){
				$form.append($('<input>', { type: 'hidden', name: key,      value: value }));
				console.log(key +'================='+value);
			});
			
		
			$('body').append($form);
			
			return false;
			$form.submit();			
		};
		
		this.downloadAttachmentFile = function(url, parameter, method){
			var methodType="";
			switch(method){
				case 'GET':
					methodType=method;
					break;
				case 'POST':
					methodType=method;
					break;
				default:
					methodType="POST";
			}
			var action = url + ".action";
			
			 
			var $form = $('<form>', {  action: action, method: methodType, target: '_blank' });
			$form.append($('<input>', { type: 'hidden', name: 'Authorization', value: $('#Authorization').val() }));
			angular.forEach(parameter, function(value, key){
				$form.append($('<input>', { type: 'hidden', name: key,      value: value }));
				 
			});
			
		
			$('body').append($form);
			 
			$form.submit();			
		};
		
		
		this.downloadAttachmentFilegetEvaluationReport = function(url, parameter, method){
			var methodType="";
			switch(method){
				case 'GET':
					methodType=method;
					break;
				case 'POST':
					methodType=method;
					break;
				default:
					methodType="POST";
			}
			var action = url + ".action";
			
			 
			var $form = $('<form>', {  action: action, method: methodType, target: '_blank' });
			$form.append($('<input>', { type: 'hidden', name: 'Authorization', value: $('#Authorization').val() }));
//			angular.forEach(parameter, function(value, key){
//				$form.append($('<input>', { type: 'hidden', name: key,      value: value }));
//				 
//			});
			
			$form.append($('<input>', { type: 'hidden', name: 'returnMap',      value: JSON.stringify(parameter) }));
			$('body').append($form);
			 
			$form.submit();			
		};
		
		
		 
		this.setActionButtonClass = function(row,tab){
			var dropdownHeight = $('.row-'+tab+'-' + row).find('ul').height() + 30;
			var arrowDirTop = true;
			var eTop = $('.row-'+tab+'-' + row).offset().top; //get the offset top of the element
			eTop = eTop - $(window).scrollTop();
			var myEl = angular.element( document.querySelector( '.row-'+tab+'-' + row ) );
			myEl.addClass('dropdown');
			if(row >10){
				if ($(window).height() - eTop < dropdownHeight) {
					myEl.removeClass('dropdown');
					myEl.addClass('dropup'); 
					arrowDirTop = false;
				}else{
					myEl.removeClass('dropup');
					myEl.addClass('dropdown');
					arrowDirTop = true;
				}  
			}
			if(arrowDirTop == false){
				$('.row-'+tab+'-' + row).find('ul').find('li:last').addClass('eborder-bottom');
			}			 
			return arrowDirTop;
		};

		this.convertToJavaScriptDateInString = function (_date,_format){	    	
			var delimeter = "";
			if(_format.indexOf("-") != -1){
				delimeter = "-";
			}else{
				if(_format.indexOf("/") != -1){
					delimeter = "/";
				}
			}

			var onlyDateArr = _date.split(" ");
			var onlyDateFormatArr = _format.split(" ");
			var onlyDate = onlyDateArr[0];
			var onlyDateFormat = onlyDateFormatArr[0];

			var formatLowerCase= onlyDateFormat.toLowerCase();
			var formatItems=formatLowerCase.split(delimeter);
			var dateItems=onlyDate.split(delimeter);
			var monthIndex=formatItems.indexOf("mm");
			var dayIndex=formatItems.indexOf("dd");
			var yearIndex=formatItems.indexOf("yyyy");
			var yrConcat = "";
			if(yearIndex == -1){
				yearIndex = formatItems.indexOf("yy");
				yrConcat = "20";
			}
			var year = "";
			if(yrConcat.length > 0 && yrConcat == "20"){
				year = yrConcat + "" + dateItems[yearIndex];
			}else{
				year = dateItems[yearIndex];
			}

			var returnString = "";
			if(onlyDateArr.length == 3){
				returnString =year + "/" + dateItems[monthIndex] + "/" + dateItems[dayIndex] + " " + onlyDateArr[1] + " " + onlyDateArr[2];
			}else{
				if(onlyDateArr.length == 2){
					returnString = year + "/" + dateItems[monthIndex] + "/" + dateItems[dayIndex] + " " + onlyDateArr[1];
				}else{
					returnString = year + "/" + dateItems[monthIndex] + "/" + dateItems[dayIndex];
				}
			}
			//var returnString =year+"-"+dateItems[monthIndex]+"-"+dateItems[dayIndex]+" "+onlyDateArr[1];
			return returnString;
		};

		this.convertToOrganizationDateFormatInString = function (_dateInLong,_format){
			_dateInLong = parseInt(_dateInLong);
			if(!isNaN(_dateInLong) && typeof _format != 'undefined') {
				var delimeter = "";
				if(_format.indexOf("-") != -1){
					delimeter = "-";
				}else{
					if(_format.indexOf("/") != -1){
						delimeter = "/";
					}
				}			
				var date = new Date(_dateInLong);			
				var onlyDateFormatArr = _format.split(" ");			
				var onlyDateFormat = onlyDateFormatArr[0]; 			
				var formatLowerCase = onlyDateFormat.toLowerCase();
				var formatItems = formatLowerCase.split(delimeter);		    
				var monthIndex = formatItems.indexOf("mm");
				var dayIndex = formatItems.indexOf("dd");
				var yearIndex = formatItems.indexOf("yyyy");
				var yrConCat = "";
				if(yearIndex == -1){
					yearIndex = formatItems.indexOf("yy");
					yrConCat = "yy";
				}		    
				if(date.getMonth() < 9){
					formatItems[monthIndex] = "0" + (date.getMonth() + 1);
				}else{
					formatItems[monthIndex] = date.getMonth() + 1;
				}		    
				if(date.getDate()<10){
					formatItems[dayIndex] = "0" + date.getDate();
				}else{
					formatItems[dayIndex] = date.getDate();
				}
				if(yrConCat == "yy"){
					var y = date.getFullYear();
					y = y+"";
					formatItems[yearIndex] = y.slice(2, 4);
				}else{
					formatItems[yearIndex] = date.getFullYear();
				}

				var timePart = "";
				if(_format.indexOf("hh:mm a") != -1){
					var hrs = date.getHours();
					var mins = date.getMinutes();
					if(hrs<12){

						var hrsMain = hrs < 10 ? (hrs == 0 ? 12 : "0" + hrs) : hrs;
						var minMain = mins < 10 ? "0" + mins : mins;

						timePart = hrsMain + ":" + minMain + " AM";
					}else{
						var hrsMain = (hrs - 12) < 10 ? (hrs - 12) == 0 ? 12 : "0" + (hrs - 12) : (hrs - 12);
						var minMain = mins < 10 ? "0" + mins : mins;

 						timePart = hrsMain + ":" + minMain + " PM";
					} 
				}else{
					if(_format.indexOf("HH:mm")!= -1){

						var hrsMain =  date.getHours() < 10 ? "0" + date.getHours() :  date.getHours();
						var minMain = date.getMinutes() < 10 ? "0" + date.getMinutes() : date.getMinutes();

						timePart = hrsMain + ":" + minMain;
					}
				}
				var convertedDate = "";
				for(var i = 0; i < formatItems.length; i++){
					if(convertedDate.length == 0){
						convertedDate = formatItems[i];
					}else{
						convertedDate = convertedDate + "" + delimeter + "" + formatItems[i];
					}
				}
				var returnString = convertedDate + " " + timePart;
				return returnString.trim();
			}		
			return '';
		};
		
		this.sortRfqItems = function(rfqItems){
			var sortedItemArray = [];
		    var parent = _.filter(rfqItems, {itemParentCode: '0'});	
		    parent = parent.sort(function(a,b){
				return(parseInt(a.indexSerialNo - parseInt(b.indexSerialNo)));
			});
		   if(rfqItems.length == parent.length){
			   return parent;
		   }
		   //remove parent item from object array 
		   rfqItems = rfqItems.filter(function(el) {
			   return parent.indexOf(el) == -1;	
		   });
		   for(var i = 0; i < parent.length; i++ ){
			    sortedItemArray.push(parent[i]);
		        this.calChild(parent[i], rfqItems, sortedItemArray);
		    }
		   return(sortedItemArray);
		};	
		
		this.calChild = function(parent, items, sortedItemArray){
			var child = _.where(items, {itemParentCode: parent.itemCode});
	        child.sort(function(a,b){
	            var index1 = a.indexSerialNo.split('.');
	            var index2 = b.indexSerialNo.split('.');
	            //return(parseInt(index2[index2.length -1]) - parseInt(index1[index1.length -1]));
	            return(parseInt(index1[index1.length -1]) - parseInt(index2[index2.length -1]));
	        });		        
	        
       		for(var i = 0; i < child.length; i++){
       			sortedItemArray.push(child[i]);
       			this.calChild(child[i], items, sortedItemArray);
	        } 
 		    return(sortedItemArray);
	    }
		
		this.calChildForDelete = function(parent, items, sortedItemArray){
			var child = _.where(items, {itemParentCode: parent.oldItemCode});
	        child.sort(function(a,b){
	            var index1 = a.indexSerialNo.split('.');
	            var index2 = b.indexSerialNo.split('.');
	            return(parseInt(index2[index2.length -1]) - parseInt(index1[index1.length -1]));
	        });		        
	        
       		for(var i = 0; i < child.length; i++){
       			sortedItemArray.push(child[i]);
       			this.calChild(child[i], items, sortedItemArray);
	        } 
 		    return(sortedItemArray);
	    }
		
		/*
		 * This function takes two object parameters and merges both their properties and returns a new object
		 */
		this.extend = function(obj1, obj2) {
			var obj = {};
			for(var prop in obj1) {
				obj[prop] = obj1[prop];
			}
			for(var prop1 in obj2) {
				obj[prop1] = obj2[prop1];
			}
			return obj;
		}
		this.success = function(msg) {
			msg = decodeURIComponent(msg);
			bootbox.alert({ 
				  size: "small",
				  title: 'successful',
				  message: msg
				});
		}
		this.handelError = function(msg,code) {
			//validationHeader and errorHeader comes form property file and it initialize footer jsp.
			var displayMsg = '';
			var msgType = '';
			if(angular.isArray(msg)){
				angular.forEach(msg, function(tabMsg){
					if(tabMsg.code.toString().length == 4){
						msgType = validationHeader;
					}else{
						msgType = errorHeader;
					}
					displayMsg +='<ul><li class="error-msg-list"><b>'+tabMsg.tabName+'</b><span style="margin-left: 10px;">('+errorValidationCode+tabMsg.code+')</span>'+decodeURIComponent(tabMsg.msg)+'</li></ul>'
				});
			}else{
				if(code.toString().length == 4){
					msgType = validationHeader+' (#'+code+')';
				}else{
					msgType = errorHeader+' (#'+code+')';
				}
				displayMsg = decodeURIComponent(msg);
				displayMsg = displayMsg.replace(/<ul>/g, "<ul style='margin-left: 20px'>").replace(/<li>/g,"<li style='list-style-type: disc;'>");
			}
        	bootbox.alert({ 
			  size: "small",
			  title: msgType,
			  message: displayMsg
			});	
        }
		
		this.handleErrorRedirectTFrontPage = function(msg,code) {
			//validationHeader and errorHeader comes form property file and it initialize footer jsp.
			var displayMsg = '';
			var msgType = '';
			if(angular.isArray(msg)){
				angular.forEach(msg, function(tabMsg){
					if(tabMsg.code.toString().length == 4){
						msgType = validationHeader;
					}else{
						msgType = errorHeader;
					}
					displayMsg +='<ul><li class="error-msg-list"><b>'+tabMsg.tabName+'</b><span style="margin-left: 10px;">('+errorValidationCode+tabMsg.code+')</span>'+decodeURIComponent(tabMsg.msg)+'</li></ul>'
				});
			}else{
				if(code.toString().length == 4){
					msgType = validationHeader+' (#'+code+')';
				}else{
					msgType = errorHeader+' (#'+code+')';
				}
				displayMsg = decodeURIComponent(msg);
				displayMsg = displayMsg.replace(/<ul>/g, "<ul style='margin-left: 20px'>").replace(/<li>/g,"<li style='list-style-type: disc;'>");
			}
        	bootbox.alert({ 
			  size: "small",
			  title: msgType,
			  message: displayMsg,
			  callback: function () {
			        window.location.href= contextPath;
			    }
			});	
        }
			
		this.getorgConfigDetailsById = function(orgId){
			var deferred = $q.defer();
			var url = contextPath + '/rest/orgConfiguration/orgConfigDetailsById?id=' + orgId;
			var promise = $http.post(url);			
			promise.then(function(res) {
				var configurationSettings = res.data;
				configurationSettings.orgConfigDateTimePickerFormat = configurationSettings.masterDateFormatDesc != null ? configurationSettings.masterDateFormatDesc.toUpperCase()+" "+ configurationSettings.masterTimeFormatDesc : configurationSettings.masterDateFormatDesc; 
				configurationSettings.orgConfigDatePickerFormat = configurationSettings.masterDateFormatDesc != null ? configurationSettings.masterDateFormatDesc.toUpperCase() : configurationSettings.masterDateFormatDesc; 
				configurationSettings.orgConfigDateTimeFormatForAngular = configurationSettings.masterDateFormatDesc != null ? configurationSettings.masterDateFormatDesc + ((configurationSettings.masterTimeFormatDesc=="hh:mm a") ? ' hh:mm a' : ' HH:mm') : configurationSettings.masterDateFormatDesc;
				if(configurationSettings.fileSizeUnit != null){
					switch(configurationSettings.fileSizeUnit.toLowerCase()) {
						case 'kb':
							configurationSettings.maxFileSizeInBytes = configurationSettings.maxFileSize * 1024;
							break;
						case 'mb':
							configurationSettings.maxFileSizeInBytes = configurationSettings.maxFileSize * 1024 * 1024;
							break;					
					}
				}
				if(res.data.fileTypeDesc != null){
					configurationSettings.allowedExtList = [];
					configurationSettings.allowedExtListDisplay = [];
					angular.forEach(res.data.fileTypeDesc.split(','), function(value, key){
						configurationSettings.allowedExtListDisplay.push(value.toUpperCase());
						configurationSettings.allowedExtList.push(value.toUpperCase());
						configurationSettings.allowedExtList.push(value.toLowerCase());
					});
					configurationSettings.fileTypeDesc = res.data.fileTypeDesc.toUpperCase();	
				}							
				deferred.resolve(configurationSettings);
			}, function(err){
				 return deferred.reject(err);
			});
			return deferred.promise;
		}
		
		this.geLoggedInUserDetails = function(){
			var deferred = $q.defer();
			$http.post(contextPath + '/rest/user/geLoggedInUserDetails')
			.then(function(response){
				return deferred.resolve(response.data);
			}, function(err){
				return deferred.reject(response);
			});
			 return deferred.promise;
		}
		
		this.geVendorStatus = function(bidderId){
			var deferred = $q.defer();
			$http.post(contextPath + '/rest/vendor/checkVendorStatus?bidderId='+bidderId)
			.then(function(response){
				return deferred.resolve(response.data);
			}, function(err){
				return deferred.reject(response);
			});
			 return deferred.promise;
		}
		
		/* @description
		 * 	This function check user is map with certificate or not with param userId.
		 * 
		 * @param relativePath		@type string
		 */
		this.getIsCertificateMappedWithUser = function(userId){
			
			var deferred = $q.defer();
			$http.post(contextPath+'/rest/user/isCertificateMappedWithUser?userId='+userId)
			.then(function(response){
				return deferred.resolve(response.data);
			}, function(err){
				return deferred.reject(response);
			});
			 return deferred.promise;
		}
		
		/* @description
		 * 	This function get tender details with param tender id.
		 * 
		 * @param relativePath		@type string
		 */
		this.getTenderInfoByTenderId = function(tenderId){
			var deferred = $q.defer();
			$http.post(contextPath+'/rest/tender/getTenderInfoByTenderId?tenderId='+tenderId)
			.then(function(response){
				return deferred.resolve(response.data);
			}, function(err){
				return deferred.reject(response);
			});
			 return deferred.promise;
		}
		/* @description
		 * 	This function get  Excluded fields to be tender sign with param group id.
		 * 
		 * @param relativePath		@type string
		 */
		this.getFieldsToBeExcludedWhileTenderSign = function(groupId){
			var deferred = $q.defer();
			$http.post(contextPath+'/rest/templategroup/getFieldsToBeExcludedWhileTenderSign?groupId='+groupId)
			.then(function(response){
				return deferred.resolve(response.data);
			}, function(err){
				return deferred.reject(response);
			});
			 return deferred.promise;
		}
		
		/* @description
		 * 	This function get TenderBidOpenerDetails  with param tender id.
		 * 
		 * @param relativePath		@type string
		 */
		this.getTenderBidOpenerDetails = function(tenderId){
			var deferred = $q.defer();
			$http.post(contextPath+'/rest/tender/getTenderBidOpenerDetailsByTenderId?tenderId='+tenderId)
			.then(function(response){
				return deferred.resolve(response.data);
			}, function(err){
				return deferred.reject(response);
			});
			 return deferred.promise;
		}
		
		/* @description
		 * 	This function get AllTenderBidOpener  with param identifyString and roleIdString =29.
		 * 
		 * @param relativePath		@type string
		 */
		this.getAllTenderBidOpenerList = function(identifyStr){
			var deferred = $q.defer();
			$http.post(contextPath+'/rest/user/getUserListByIdentifyStringAndRole?identifyString='+identifyStr+'&roleIdString=29')
			.then(function(response){
				return deferred.resolve(response.data);
			}, function(err){
				return deferred.reject(response);
			});
			 return deferred.promise;
		}
		
		/* @description
		 * 	This function get authorised nod count with param tender id.
		 * 
		 * @param relativePath		@type string
		 */
		this.getAuthorizedBidCountByTenderId = function(tenderId){
			var deferred = $q.defer();
			$http.post(contextPath+'/rest/quotation/getAuthorizedBidCountByTenderId?tenderId='+tenderId)
			.then(function(response){
				return deferred.resolve(response.data);
			}, function(err){
				return deferred.reject(response);
			});
			 return deferred.promise;
		}
		
		
		/* @description
		 * 	This function get bid opener list by bidpart no count with param tender id.
		 * 
		 * @param relativePath		@type string
		 */
		this.getBidOpenersByTenderIdAndPartNo = function(tenderId, bidPartNo){
			var deferred = $q.defer();
			$http.post(contextPath+'/rest/quotation/getBidOpenersByTenderIdAndPartNo?tenderId='+tenderId+'&bidPartNo='+bidPartNo)
			.then(function(response){
				return deferred.resolve(response.data);
			}, function(err){
				return deferred.reject(response);
			});
			 return deferred.promise;
		}
		
		/* @description
		 * 	This function get bid Mark as presense by  param tender id and quotation id.
		 * 
		 * @param relativePath		@type string
		 */
		this.markAsPresense = function(tenderId, quotationId, bidPartNo){
			var deferred = $q.defer();
			$http.post(contextPath+'/rest/quotation/updateEncryptionDecryption?tenderId='+tenderId+'&partNo='+bidPartNo+'&quotationId='+quotationId)
			.then(function(response){
				return deferred.resolve(response.data);
			}, function(err){
				return deferred.reject(response);
			});
			 return deferred.promise;
		}
		
		
				
		/* @description
		 * 	This function downloads file of a dynamic template field.
		 * 
		 * @param relativePath		@type string
		 * @param originalFile		@type string
		 */
		this.downloadDynamicFieldAttachment = function(relativePath, originalFile) {			
			var action = contextPath + '/vendor/downloadDynamicAttachment.action';
			var $form = $('<form>', { action: action, method: 'POST', target: '_blank' });				
			var relativePathInput = $('<input>', { type: 'hidden', name: 'path',     value: relativePath });
			var fileNameInput 	  = $('<input>', { type: 'hidden', name: 'fileName', value: originalFile });
			$form.append($('<input>', { type: 'hidden', name: 'Authorization', value: $('#Authorization').val() }));
			$form.append(relativePathInput);
			$form.append(fileNameInput);
			$('body').append($form);
			$form.submit();		
		};
		
		 /* Column filter functionality Starts*/
		
		this.filterColFuncHelper = function(allColumnList,selectedCols){
			angular.forEach(allColumnList, function(element, key){
				if(element.checked){
					selectedCols.push(element.colId);
				}
		    });
			return selectedCols;
		};
		
		//workflow submit section
		
		this.responseNameForRadioBtnService = function(userObj,dataArr){
			// get all dop users from list which are active
		    //	var tempArrayList = _.where($scope.approval.approvalDetails, {isActive: 1});
		    	var radIndex = 0;
		    	var firstOccurance = 0;
		       // if (tempArrayList != undefined && tempArrayList.length > 0) {
		        	// getting index of user from userobj
		        	var userIndex = dataArr.indexOf(userObj);
		        	// check whether approval type is not 'S' and also user index not equal to 0
		            if (dataArr[userIndex].approvalType !== 'S' && userIndex !== 0) {
		                var i = userIndex;
		                while (i > 0) {
		                	// condition is not undefined and check for back radindex
		                    if (dataArr[i - 1].radIndex) {
		                        radIndex = dataArr[i - 1].radIndex || 0;
		                        break;
		                    }
		                    // condition is if 0 for better approach when seen user edit the doplist 
		                    if (dataArr[i - 1].radIndex == 0) {
		                        radIndex = 0;
		                        break;
		                    }
		                    i -= 1;
		                }
		                var isComplete = false; // for less iterate for loop
		                angular.forEach(dataArr, function(val, idx){
		                	// if isComplete false and approvaltype is 'P'
		                	if(val.approvalType === 'P' && !isComplete){
		                		// set first occurance id and isComplete to true
		                		firstOccurance = idx;
		                		isComplete = true;
		                	}
		                });
		                // Check whether lastuser approval type 'S'
		                if (dataArr[userIndex - 1].approvalType === 'S' && firstOccurance+1 <= userIndex ) {
		                    radIndex = radIndex + 1;
		                }
		            }
		            // set generated radIndex to the user obj 
		            dataArr[userIndex].radIndex = radIndex;
		       // }
		        var rtrn = 'rad_' + radIndex;
		        // return with padding 'rad_'
		       
		        return rtrn;
			
		};
		
		this.updateReassignmentDetailsForpendingdata = function(data) {
			//$rootScope.loader.show = true;
			var promise = $http({
				url: workflowUrl + '/rest/workflow/updatePendingDataForApproval',
				method: "post",
				data: data
			});

			promise.then(function() {
				$rootScope.loader.show = false;
			}, function(err) {  $rootScope.loader.show = false; 
			utilityService.handelError(err.headers('errorMsg'),err.status);	
			});

			return promise;
		};
		
		this.updateReassignmentDetailsForSanctionNote = function(data) {
			//$rootScope.loader.show = true;
			var promise = $http({
				url: contextPath + '/rest/sanctionnote/updateSanctionOwner',
				method: "post",
				data: data
			});

			promise.then(function() {
				$rootScope.loader.show = false;
			}, function(err) {  $rootScope.loader.show = false; 
			utilityService.handelError(err.headers('errorMsg'),err.status);	
			});

			return promise;
		};
		
		this.updatePOHeaderDetails = function(data) {
			//$rootScope.loader.show = true;
			var promise = $http({
				url: postTenderUrl + '/rest/po/updatePoOwner',
				method: "post",
				data: data
			});

			promise.then(function() {
				$rootScope.loader.show = false;
			}, function(err) {  $rootScope.loader.show = false; 
			utilityService.handelError(err.headers('errorMsg'),err.status);	
			});

			return promise;
		};
		
		this.updateReassignmentDetailsForTenderOpener = function(data) {
			//$rootScope.loader.show = true;
			var promise = $http({
				url: contextPath + '/rest/tender/updateTenderOpenerOwner',
				method: "post",
				data: data
			});

			promise.then(function() {
				$rootScope.loader.show = false;
			}, function(err) {  $rootScope.loader.show = false; 
			utilityService.handelError(err.headers('errorMsg'),err.status);	
			});

			return promise;
		};
		
		this.getChildOrgList = function(deptId) {
			var url = contextPath + '/rest/organization/getChildOrg?orgId='+deptId;
			var promise = $http.post(url);			
			return promise;
		};
		
		
		this.checkFnService=function(row)
		 {
			 if(row.coordinatorFlag=='Y' || row.coordinatorFlag=='rad_999')
			 {
				 return true;
			 }else
			 {
				 return false;
			 }
		 }
		
		this.checkForApprovalTypeService=function(userObj, isLast,dataArr){
			var isCreated = false;
	        var allSParam = true;
	        angular.forEach(dataArr, function(val, idx) {
	            if (val.approvalType === 'S') {
	            	if(isLast==false){
	                val.coordinatorFlag = '';
	            	}
	            	
	            } else if (val.approvalType === 'P') {
	            	allSParam = false;
	            }
	        });
	        if (userObj.approvalType === 'S' && isLast) {
	            userObj.coordinatorFlag = 'rad_999';
	        }
	        if(allSParam && isLast){
	        	isCreated = true;
	        }
	        return isCreated;
		}
		this.radioCheckUncheckService=function(userObj,event,dataArr){
			
	    	if(dataArr.length>0) {
	    		angular.forEach(dataArr, function(val, idx) {
	    			if(event.target.value === val.coorinatorFlag && val.userId != userObj.userId){
	    				val.coorinatorFlag = '';
	    			}
	    		});
	    	}
	    	for(var a=0;a<dataArr.length;a++){
	    		if(dataArr[a].radVal == userObj.radVal){
	    			dataArr[a].coordinatorFlag='N';
	    		}
	    	}
	    	var userIndex = dataArr.indexOf(userObj);
	    	
	    	return dataArr[userIndex].coordinatorFlag='Y';
		}
		
		//workflow submit section
		
		this.filterColumnFunc = function(allColumnList, selectedCols, colId){
			var ide = selectedCols.indexOf(colId);
			
	    	if (ide > -1 && selectedCols.length > 0) {
	    		selectedCols.splice(ide, 1);
	    	}
	    	else{
	    		selectedCols.push(colId);
	    	}
	    	if(selectedCols.length <= 3){
	    		angular.forEach(allColumnList, function(element, key){
	    	    	if(element.checked){
	    	    		element.disabled = true;
	    	    	}
	    	    });
	    	}
	    	else{
	    		angular.forEach(allColumnList, function(element, key){
	    	    		element.disabled = false;
	    	    });
	    	}
	    	return allColumnList;
		};
		
		 /* Column filter functionality Ends*/
		/*SUCCESS/ ERROR MSG*/
	    this.successAlert = function(message, alertType){
			if(message == undefined || message == null) 
				message = 'Success!';
			if(alertType == 'success'){
				$('#alerts').append(
						'<div class="alert alert-success text-center">'+
							'<a href="#" data-dismiss="alert" class="close">&times;</a>'+
							message +
						'</div>'
				);
				setTimeout(function() {
					$('.alert-success').fadeOut(5000);
				}, 3000);
			}
			else if(alertType == 'danger'){
				$('#alerts').append(
						'<div class="alert alert-danger text-center">'+
							'<a href="#" data-dismiss="alert" class="close">&times;</a>'+
							message +
						'</div>'
				);
				setTimeout(function() {
					$('.alert-danger').fadeOut(5000);
				}, 3000);
			}
			
	    }
	    /*SUCCESS/ ERROR MSG*/
	    
	    /* PKI verification start */
	    this.verifiedSignHash = function(excludeObj,Obj, orderByFilter, flag){
	    	var datahash = "";
	    	if(flag == "tender") {
	    		datahash=datahash+"tenderid:"+Obj.tenderid+"|";
	    		datahash=generateHashStringForTenderDataCreationVerify(excludeObj,Obj,datahash,orderByFilter); 
	    	}else if(flag == "quotation") {
    			datahash=datahash=datahash+"tenderid:"+Obj.tenderId+"|"+"quotationid:"+Obj.quotationId+"|";
    			datahash=generateHashString(Obj,datahash,orderByFilter); 
	    	}
			$("#verifyHashString").val(datahash);
			$("#verifySignHash").val(Obj.signHash);
			var sourceField="verifySignHash";
			var hashField="verifyHashString";
			// userid from session
			var loginUserId=$("#loginUserId").val();
			var paramList=loginUserId;
			pkiSignVerifyData(sourceField,hashField,Obj.dscPublicKey,Obj.dscCertString,verifySignHashScopeHolder,paramList,"serverDate");
	    }
	    
	    /*this.verifiedSignHash = function(Obj, orderByFilter, flag){
	    	var datahash = "";
			datahash=datahash+"tenderid:"+Obj.tenderid+"|";
			datahash=generateHashString(Obj,datahash,orderByFilter);
			$("#verifyHashString").val(datahash);
			$("#verifySignHash").val(Obj.signHash);
			var sourceField="verifySignHash";
			var hashField="verifyHashString";
			// userid from session
			var loginUserId=$("#loginUserId").val();
			var paramList=loginUserId;
			pkiSignVerifyData(sourceField,hashField,verifyTenderSignHashScopeHolder,paramList,"serverDate");
	    }*/
	    
	    this.verifyTenderSignHash=function(response){
	    	alert("Verified Successfully.")	;
		};
		verifyTenderSignHashScopeHolder=this.verifyTenderSignHash;
		verifySignHashScopeHolder=this.verifySignHash;
		
		this.verifyFileSignHash = function(fileSignHash,fileDataHash,dscPublicKey,dscCertString){
			$("#verifyFileHashString").val(fileDataHash);
			$("#verifyFileSignHash").val(fileSignHash);
			var sourceField="verifyFileSignHash";
			var hashField="verifyFileHashString";
			// userid from session
			var loginUserId=$("#loginUserId").val();
			var paramList=loginUserId;
			pkiSignVerifyData(sourceField,hashField,dscPublicKey,dscCertString,verifyFileSignHashScopeHolder,paramList,"serverDate");
	    }
	    
	    this.verifyFileSignHashSuccess=function(response){
	    	alert(" filesignhash Verified Successfully.")	;
		};
		verifyFileSignHashScopeHolder=this.verifyFileSignHashSuccess;
		
		this.verifyClarificationDataSignHash = function(SignHash,DataHash,dscPublicKey,dscCertString){
			$("#clarificationVerifyDataHash").val(DataHash);
			$("#clarificationVerifySignHash").val(SignHash);
			var sourceField="clarificationVerifySignHash";
			var hashField="clarificationVerifyDataHash";
			// userid from session
			var loginUserId=$("#loginUserId").val();
			var paramList=loginUserId;
			pkiSignVerifyData(sourceField,hashField,dscPublicKey,dscCertString,verifyClarificationDataSignHashScopeHolder,paramList,"serverDate");
	    }
		verifyClarificationDataSignHashScopeHolder=this.verifiedClarificationDataSignHash;
		 this.verifiedClarificationDataSignHash=function(response){
		    	alert(" ClarificationData Verified Successfully.")	;
			};
			
			this.verifyBidEvalDataSignHash = function(SignHash,DataHash,dscPublicKey,dscCertString){
				$("#overAllCommentsDataHash").val(DataHash);
				$("#overAllCommentsSignHash").val(SignHash);
				var sourceField="overAllCommentsSignHash";
				var hashField="overAllCommentsDataHash";
				// userid from session
				var loginUserId=$("#loginUserId").val();
				var paramList=loginUserId;
				pkiSignVerifyData(sourceField,hashField,dscPublicKey,dscCertString,verifyBidEvalDataSignHashScopeHolder,paramList,"serverDate");
		    }
			verifyBidEvalDataSignHashScopeHolder=this.verifiedBidEvalDataSignHash;
			 this.verifiedBidEvalDataSignHash=function(response){
			    	alert(" bideval data Verified Successfully.")	;
				};
				this.verifyBidderDetailsSignHash = function(SignHash,DataHash,dscPublicKey,dscCertString){
					$("#bidderApproverOACommentsDataHash").val(DataHash);
					$("#bidderApproverOACommentsSignHash").val(SignHash);
					var sourceField="bidderApproverOACommentsSignHash";
					var hashField="bidderApproverOACommentsDataHash";
					// userid from session
					var loginUserId=$("#loginUserId").val();
					var paramList=loginUserId;
					pkiSignVerifyData(sourceField,hashField,dscPublicKey,dscCertString,verifyBidderDetailsSignHashScopeHolder,paramList,"serverDate");
			    }
				verifyBidderDetailsSignHashScopeHolder=this.verifiedBidderDetailsSignHash;
				 this.verifiedBidderDetailsSignHash=function(response){
				    	alert(" bideval data Verified Successfully.")	;
					};
	    /* PKI verification end  */
	    
	    
	    /*
	    ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	        TO FETCH COLOUMN FROM DB
	    ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	    */
	    
	    this.getAllActiveColumns = function(url,pageId){
	    	url = url + pageId;
	    	console.log("From getAllActiveColumns(): url = " + url);
	    	var q = $q.defer();
	    	RestAPI.postAPI({},url).then(
		    	function(rs){
		    		q.resolve(rs);
		    	}, 
		    	function(err){
		    		q.reject(err);
		    	}
	    	);
	    	return q.promise;
	    };
	    
	    /*
	    ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	        TO SAVE COLOUMN FROM DB
	    ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	    */
	    this.setActiveColumns = function(url,pageId,coloumnValueParam,selectedColoumns){
	    	url = url + pageId + coloumnValueParam + selectedColoumns.toString();
	    	console.log("From getAllActiveColumns(): url = " + url);
	    	var q = $q.defer();
	    	RestAPI.postAPI({},url).then(
		    	function(rs){
		    		q.resolve(rs);
		    	}, 
		    	function(err){
		    		q.reject(err);
		    	}
	    	);
	    	return q.promise;
	    };
	    
	    
	});
	function convert_number(number)
	{
		if ((number < 0) || (number > 99999999999999))
		{ 
			return "NUMBER OUT OF RANGE!";
		}
		var Gn = Math.floor(number / 10000000);  /* Crore */ 
		number -= Gn * 10000000; 
		var kn = Math.floor(number / 100000);     /* lakhs */ 
		number -= kn * 100000; 
		var Hn = Math.floor(number / 1000);      /* thousand */ 
		number -= Hn * 1000; 
		var Dn = Math.floor(number / 100);       /* Tens (deca) */ 
		number = number % 100;               /* Ones */ 
		var tn= Math.floor(number / 10); 
		var one=Math.floor(number % 10); 
		var res = ""; 

		if (Gn>0) 
		{ 
			res += (convert_number(Gn) + " CRORE"); 
		} 
		if (kn>0) 
		{ 
				res += (((res=="") ? "" : " ") + 
				convert_number(kn) + " LAKH"); 
		} 
		if (Hn>0) 
		{ 
			res += (((res=="") ? "" : " ") +
				convert_number(Hn) + " THOUSAND"); 
		} 

		if (Dn) 
		{ 
			res += (((res=="") ? "" : " ") + 
				convert_number(Dn) + " HUNDRED"); 
		} 


		var ones = Array("", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX","SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN", "TWELVE", "THIRTEEN","FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN","NINETEEN"); 
	var tens = Array("", "", "TWENTY", "THIRTY", "FOURTY", "FIFTY", "SIXTY","SEVENTY", "EIGHTY", "NINETY"); 

		if (tn>0 || one>0) 
		{ 
			if (!(res=="")) 
			{ 
				res += " AND "; 
			} 
			if (tn < 2) 
			{ 
				res += ones[tn * 10 + one]; 
			} 
			else 
			{ 

				res += tens[tn];
				if (one>0) 
				{ 
					res += ("-" + ones[one]); 
				} 
			} 
		}

		if (res=="")
		{ 
			res = "ZERO"; 
		} 
		return res;
	}
	
	function convert_frac_number(number){
		/*if ((number < 0) || (number > 999)) 
		{ 
			return " DECIMAL OUT OF RANGE!";
		}*/
		var positionsVal = Array("ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX","SEVEN", "EIGHT", "NINE");
		var res = ""; 
		
	    var sNumber = number.toString();

		for (var i = 0, len = sNumber.length; i < len; i += 1) {
		    /*if(sNumber.length <= 3){
				res += (" " + positionsVal[sNumber.charAt(i)]);
			}else{
				return " DECIMAL OUT OF RANGE!";
			}*/
			res += (" " + positionsVal[sNumber.charAt(i)]);
			
		}
		return res;
	}
})();





