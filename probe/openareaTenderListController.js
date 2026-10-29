var app = angular.module('epsv2App', ['datatables', 'commonFunctionalities', 'utility', 'ae-datetimepicker', 'ngSanitize']);


app.config(['$httpProvider', function($httpProvider) {
	if (!$httpProvider.defaults.headers.get) {
		$httpProvider.defaults.headers.get = {};    
	}    
	$httpProvider.defaults.headers.get['If-Modified-Since'] = 'Mon, 26 Jul 1997 05:00:00 GMT';
	$httpProvider.defaults.headers.get['Cache-Control'] = 'no-cache';
	$httpProvider.defaults.headers.get['Pragma'] = 'no-cache';
}]);

app.run(['$http',function($http) {
	$http.defaults.headers.common['Content-Type'] = 'application/json;charset=utf-8;' ;
	$http.defaults.headers.common['Access-Control-Allow-Origin'] = '*';
	$http.defaults.headers.common['Auth-Token'] = 'X-Requested-With';
	$http.defaults.headers.common['Authorization'] = $('#Authorization').val();
}]);

app.filter('titleCase', function() {
	return function(input) {
		input = input || '';
		return input.replace(/\w\S*/g, function(txt){return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();});
	};
});
app.filter('trustHtml',function($sce){
	  return function(html){
		    return $sce.trustAsHtml(html)
		  };
		});
app.filter('splitAndGet', function() {
	return function(str, splitChar, indexElementToGet) {
		if(str == null)
			return '';
		else
		return str.split(splitChar)[indexElementToGet];
	};
});

app.filter('tenderFn', function(obj) {
	//$scope.filterByGenres = function(movie) {
	//$scope.tenderList = $filter('filter')($scope.allTenderList, {$: keyword});
        return ($scope.allTenderList.indexOf(obj.currenttenderid) !== -1);
  //  };
	/*return function( items,tenderRfqTypeId ) {
		var filtered = [];
		if(tenderRfqTypeId !== undefined && !isNaN(tenderRfqTypeId) && tenderRfqTypeId !='' && tenderRfqTypeId !=null){
			angular.forEach(items, function(item) {
				var c1 = (item.currenttenderid).toString();
				var c2 = (item.currenttenderrefno).toString();
				if(c1.indexOf(tenderRfqTypeId) != -1  ) {
					filtered.push(item);
				}
				if( c2.indexOf(tenderRfqTypeId) != -1 ) {
					filtered.push(item);
				}
			});
			return filtered;
		}else{
			return items;
		}

	};*/
});

app.filter('filterMultiple',['$filter',function ($filter) {
	return function (items, keyObj) {
		var filterObj = {
							data:items,
							filteredData:[],
							applyFilter : function(keyObj){
								this.filteredData = this.data;								
								var fObj = {};
								angular.forEach(keyObj,function(obj,key){
									if(angular.isDefined(obj) && obj != null){
										fObj[key] = obj;	
									}
								});
								this.filteredData = $filter('filter')(this.filteredData,fObj);
							}
				};

		if(keyObj){
			filterObj.applyFilter(keyObj);
		}		
		return filterObj.filteredData;
	}	    
}]);

app.filter('filterMultipleOld',['$filter',function ($filter) {
	return function (items, keyObj) {
		var filterObj = {
				data:items,
				filteredData:[],
				applyFilter : function(obj,key){
					var fData = [];
					if(typeof this.filteredData !== 'undefined'){
						if(this.filteredData.length == 0)
							this.filteredData = this.data;
					}
					if(obj){
						var fObj = {};
						if(!angular.isArray(obj)){
							fObj[key] = obj;
							fData = fData.concat($filter('filter')(this.filteredData,fObj));
						}else if(angular.isArray(obj)){
							if(obj.length > 0){	
								for(var i=0;i<obj.length;i++){
									if(angular.isDefined(obj[i])){
										
										fObj[key] = obj[i];
										
										fData = fData.concat($filter('filter')(this.filteredData,fObj));	
										
										//
										if(obj[i]=="No")
											{
												for(var j=0;j<this.filteredData.length;j++)
													{
													if(this.filteredData[j].isCorrigendum=="" || this.filteredData[j].isCorrigendum==null)
														{
														fData = fData.concat(this.filteredData[j]);
														}
													}
											}
									}
								}
							}										
						}									
						if(fData.length > 0){
							this.filteredData = fData;
						}
					}
				}
		};

		if(keyObj){
			angular.forEach(keyObj,function(obj,key){
				filterObj.applyFilter(obj,key);
			});			
		}

		return filterObj.filteredData;
	}

}]);
app.filter('trustHtml',function($sce){
	  return function(html){
		    return $sce.trustAsHtml(html)
		  };
		});
app.filter('codeFilterOrg',['$filter','$rootScope',function ($filter,$rootScope) {
	return function (items, keyObj) {
		var orgArr;
		if($rootScope.orgListAll && $rootScope.orgListAll.length>0){
		    orgArr=$filter('filter')($rootScope.orgListAll,{organizationId:parseInt(keyObj.code)});
            if(orgArr.length>0)
            {
                return orgArr[0].organizationName;
            }
		}
	}	    
}]);
app.filter("dateRange", function() {
	  return function(items, fromDate, toDate,type) {
		  var filtered=[];
		    //date filter

	        var from_date = (fromDate && !isNaN(Date.parse(fromDate))) ? moment(fromDate,"DD-MM-YYYY") : 0;
	        var to_date = (toDate && !isNaN(Date.parse(toDate))) ? moment(toDate,"DD-MM-YYYY") : 0;
	         var compareDate;
	        // if the items are loaded
	        if (items && items.length > 0){
	        	$.each(items, function (index, item){
	        		var startDate,endDate;
	        		if(type==1){
                        compareDate = moment(item.currentTenderPublishDate);
	        		}else if(type==2){
	        		    compareDate = moment(item.currentbidStartDate);
	        		}else if(type==3){
                        compareDate = moment(item.currentbidEndDate);
                    }
                    if(from_date!=0 && to_date==0){
                        if(compareDate.isSame(from_date,'day') || compareDate.isAfter(from_date,'day')){
                            filtered.push(item);
                        }
                    }else  if(from_date==0 && to_date!=0){
                        if(compareDate.isSame(to_date,'day') || compareDate.isBefore(to_date,'day')){
                            filtered.push(item);
                        }
                    }else if(from_date!=0 && to_date!=0){
                        if(compareDate.isSame(from_date,'day') || compareDate.isSame(to_date,'day') || compareDate.isBetween(from_date,to_date,'day')){
                            filtered.push(item);
                        }
                    }

	        	});
	        }
            return filtered;
	  };
});

app.filter("dateSpan", function() {
	  return function(items, span,tab) {
		  var filtered=[];
		    //date filter
	        var from_date,to_date;
	        var compareDate;
	        // if the items are loaded
	        if (items && items.length > 0){
	        	$.each(items, function (index, item){
	        		if(tab=='cancelTenders'){
                        from_date =moment().subtract(span,'days').valueOf();
                        to_date = moment().valueOf();
                        compareDate = moment(item.currentTenderCancelDate);
	        		}else if(tab=='pastTenders'){
                          from_date =moment().subtract(span,'days').valueOf();
                          to_date = moment().valueOf();
                          compareDate = moment(item.currentbidEndDate);
                    }else{
	        		    from_date = moment().valueOf();
                        to_date = moment().add(span,'days').valueOf();
                        compareDate = moment(item.currentbidEndDate);
	        		}
	        		if(span>1){
	        		    if (compareDate.isBetween(from_date,to_date)) {
                             filtered.push(item);
                        }
	        		}else{
	        		    if (compareDate.isSame(moment().valueOf(),'days')) {
                             filtered.push(item);
                        }
	        		}

	        	});
	        }
            return filtered;
	  };
});
app.factory('errorh', function() {
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
});
app.directive('timeCountdown', function(){
    return {
        restrict: 'A',
        scope: {
        	timeCountdown: "="
        },
        link: function($scope, element, attrs){
            $(element).countdown($scope.timeCountdown, function(event) {
                $(element).html(event.strftime('%D:%H:%M'));
            });
        }
    }
});
app.controller('openareaTenderList', ['$q','$scope','$compile','$http', '$window', '$timeout','$interval', '$filter','errorh', 'commonService','$rootScope','utilityService', function($q,$scope,$compile, $http, $window, $timeout, $interval, $filter, errorh, commonService, $rootScope, utilityService){
	$scope.searchOptionsList = $window.searchOptions;
	$scope.openareaTenderListFilter = {};
	$scope.loadOrgInfoForAddNewOrg = {};
	$scope.orgList=null;
	$scope.cancelTab=false;
	$scope.pastTendersTab=false;
	$scope.tenderFilter = null;
	$scope.tenderF = {};
	$scope.tenderList = [];
	$scope.allCancelTenderList=[];
	$scope.alltenderWithCorrigendumList=[];
	$scope.allupcomingtendersList=[];
	$scope.allpasttendersList=[];
	$scope.isGenFormValid = false;
	$scope.reverseSort = false;
	$scope.orderByField = 'currentbidStartDate';
	$scope.openAreaTender=true;
	$scope.showList = {
			latestTender: true,
			latestCancelTender:false,
			organisationList: false,
			allOther: false
	}
	$scope.showListItem = 'latestTender';
	$scope.searchInformationForm = {};
	$scope.openAreaLoadTendetListCount = 20;
	$scope.openAreaLoadCancelTenderListCount = 20;
	$scope.openAreaLoadtenderWithCorrigendumListCount = 20;
	$scope.openAreaUpcomingTendersListCount = 20;
	$scope.openAreaPastTendersListCount = 20;
	$scope.isOrgIdNotZero = false;
	$scope.isPacValShow=false;
	$scope.totalCount=0;  
	$scope.pageIndex = 1;
	
	$scope.init = function(){
		$('#loading').show();
		if(orgId != 0){
			$scope.openareaTenderListFilter.orgId = orgId; //it will come from backend
			$scope.isOrgIdNotZero = true;
		}
		else{
			$scope.isOrgIdNotZero = false;
		}
 	
		let promise=[];
		promise.push($http.post(contextPath+"/rest/master/getDefaultDateTimeFormat"));
		promise.push($http.post(contextPath+'/rest/master/getMasterListForOpenareaTenderListing'));
		promise.push($http.post(contextPath+"/rest/organization/loadAllDeptWithParent?orgId="+$window.orgId));
		promise.push($http.post(contextPath+'/rest/master/showRfqCategoryRfqTypeProcCatBidPartList'));
		$q.all(promise).then(function(res){
		    if(res[0].data.dateTimeFormat){
                var defaultDateFormat=res[0].data.dateTimeFormat.split(" ")[0];
                defaultDateFormat = defaultDateFormat.toUpperCase();
                $rootScope.datePickerOption = {
                        format: defaultDateFormat,
                        showClose: true,
                        showClear:true,
                        useCurrent: false
                }
            }
            $scope.allListFilterCombo = res[1].data;
            $scope.orgList = res[2].data;
            $rootScope.orgListAll = res[2].data;
            $scope.search();
            $scope.categoryTypeList = res[3].data;
            $('#loading').hide();
            if(location.hash){
                let url=location.href.replace(/\/$/,'');
                const hash=url.split('#');
                $('a[href="#'+hash[1]+'"]').tab('show');
                $scope.tabClicked(hash[1]);
            }else{
                 $scope.tabClicked('latestTenders');
            }
		},function(err){
            $('#loading').hide();
            utilityService.handelError(err.headers('errorMsg'),err.status);
        });
	};

	$scope.timeLeft=function(eventTime,element){
	    let duration=moment.duration((eventTime-moment().valueOf())*1000,'milliseconds');
	    setInterval(function(){
	        duration=moment.duration(duration-1000,'milliseconds');
	        $(element).text( duration.hours()+':'+duration.minutes());
	    },1000);
	}

	$scope.getOrgLabel = function(orgId){
		if($scope.openareaTenderListFilter.orgId !=null){
			$("#loading").show();
			var getProcCatUrl = contextPath+'/rest/master/categoryLists?orgId='+ orgId;
			var getProcCatList = $http.post(getProcCatUrl);
			getProcCatList.success(function(res){
				$scope.allListFilterCombo.ProcCategoryList = res;
			});
			getProcCatList.error(function(data, status, headers, config) {
				errorh.handelError(headers('errorMsg'),status);
			});
			
			
			
			var loadHeaderUrl = contextPath+'/rest/organization/loadOrgLevelInfoMapForOrg?orgId=' + orgId;
			var loadHeaderInfo = $http.post(loadHeaderUrl);
			loadHeaderInfo.success(function(res){
				$scope.loadHeaderList = res;
				$scope.headerLength = Object.keys($scope.loadHeaderList).length;
				$("#loading").hide();					
				$scope.organization={};						
				angular.forEach($scope.loadHeaderList, function(val,key){
					if(!$scope.loadOrgInfoForAddNewOrg.hasOwnProperty(key)){
						$scope.loadOrgInfoForAddNewOrg[key] = [];
					}
				});
				$scope.organization[1] = $scope.openareaTenderListFilter.orgId;
				$scope.loadChild(1);
			});
			loadHeaderInfo.error(function(data, status, headers, config) {
				errorh.handelError(headers('errorMsg'),status);
			});
		}else{
			$scope.loadHeaderList = {};
			$scope.loadOrgInfoForAddNewOrg={};
			$scope.organization={};
			$scope.openareaTenderListFilter.deptId = null;
		}		
	};


	/*
	 * load child label data
	 */
	$scope.loadChild = function(key){
		var loadChildOrgUrl = contextPath+"/rest/organization/getChildOrgUnderProvidedOrgID?orgId="+$scope.organization[key];
		if($scope.organization[key] != null){
			$("#loading").show();
			var loadChildOrgPromiss = $http.post(loadChildOrgUrl);
			loadChildOrgPromiss.success(function(res){
				$scope.loadChildOrg = res;		
				if($scope.loadOrgInfoForAddNewOrg.hasOwnProperty(key+1)){
					$scope.loadOrgInfoForAddNewOrg[key+1] = [];
					angular.forEach($scope.loadChildOrg, function(val,indx){
						$scope.loadOrgInfoForAddNewOrg[key+1].push(val);
					});
				}
				$scope.openareaTenderListFilter.deptId = ($scope.organization[key]);
				$scope.loading = false;
				$("#loading").hide();
			});

			loadChildOrgPromiss.error(function(data, status, headers, config) {
				$("#loading").hide();
				errorh.handelError(headers('errorMsg'),status);
			});
		}else{
			angular.forEach($scope.loadOrgInfoForAddNewOrg, function(val,indx){
				if(parseInt(indx)+1 > key){
					$scope.loadOrgInfoForAddNewOrg[key+1] = [];
				}else if(key == 2){
					angular.element(document.querySelector("#deptId")).val(parseInt($scope.openareaTenderListFilter.orgId));
					$scope.openareaTenderListFilter.deptId= parseInt($scope.openareaTenderListFilter.orgId);
				}else if(parseInt(indx)+1 == key-1){
					for(var org in $scope.organization){
						if($scope.organization[org]==null){
							if(parseInt(org) == 2){
								$scope.openareaTenderListFilter.deptId= parseInt($scope.openareaTenderListFilter.orgId);
								break;
							}else{
								$scope.openareaTenderListFilter.deptId = ($scope.organization[org-1]);
								break;
							}

						}
					}
				}
			});
		}
	};

	$scope.openSearchModal =  function(option){
		$scope.currentSearchOption = option;		
		$timeout(function(){
			//$("#"+ option).modal("show");
			var settings={
					format: 'dd-mm-yyyy',
					startView: 'month',
					minView: 'month',
					autoclose: true
			};
			$('#fromDatetimepicker').datetimepicker(settings);
			$('#toDatetimepicker').datetimepicker(settings);
			$('#closingDate').datetimepicker(settings);
			$('#toStatusDatetimepicker').datetimepicker(settings);
			$('#fromStatusDatetimepicker').datetimepicker(settings);
			$('#publishedFromDatetimepicker').datetimepicker(settings);
			$('#publishedToDatetimepicker').datetimepicker(settings);
			if(orgId != 0 && $scope.searchOptionsList['tenderSearchByOrganisation'] == $scope.currentSearchOption){
				$scope.getOrgLabel($scope.openareaTenderListFilter.orgId)
			}			
			$('#'+ $scope.currentSearchOption).on('hidden.bs.modal', function (e) {				
			    $scope.searchInformationForm[$scope.currentSearchOption].$setPristine();
			    $scope.closeModal();
			});
		},500);
	};	

	$scope.getTimeDifference = function(endLong){
		var retVal;
		var endDate = new Date(endLong);
		// Do your operations
		var today   = new Date();
		var seconds = Math.round((endDate.getTime() - today.getTime()) / 1000);
		if(seconds > 0){
			var h = Math.floor(seconds / 3600);
			if(h<10){
				h= '0'+h;
			}
		    var m = Math.floor(seconds % 3600 / 60);
		    if(m<10){
				m= '0'+m;
			}
		    retVal = h+" : "+m;
		}else{
			retVal = "00 : 00";
		}
		
		return retVal;
	}
	$scope.search = function(showList){
		$scope.tenderFilter = null;
		
		if(angular.isDefined(showList)){
			$scope.showListItem = showList;
		}
		if(angular.isDefined($scope.openareaTenderListFilter.valueCriteriaId) && $scope.openareaTenderListFilter.valueCriteriaId != null){
			var errMsg = '';
			if(angular.isUndefined($scope.openareaTenderListFilter.valueTypeId) || $scope.openareaTenderListFilter.valueTypeId == ''){
				errMsg = msg1;      		
			}else{
				if($scope.openareaTenderListFilter.valueTypeId == 103){
					if((angular.isUndefined($scope.openareaTenderListFilter.valueCriteriaFrom) || $scope.openareaTenderListFilter.valueCriteriaFrom == '')
							|| (angular.isUndefined($scope.openareaTenderListFilter.valueCriteriaTo) || $scope.openareaTenderListFilter.valueCriteriaTo == '')){
						errMsg = msg2;
					}
				}else{
					if(angular.isUndefined($scope.openareaTenderListFilter.valueCriteriaFrom) || $scope.openareaTenderListFilter.valueCriteriaFrom == ''){
						errMsg = msg3;
					}
				}				
			}

			if(errMsg != ''){
				bootbox.alert({ 
					size: "small",
					title: "Alert",
					message: errMsg,
					callback: function(){}
				});
				$('#loading').hide();
				return;
			}    		
		}
		
		if($scope.openareaTenderListFilter.dateCriteriaFrom != undefined && $scope.openareaTenderListFilter.dateCriteriaTo != undefined){
			if($scope.openareaTenderListFilter.dateCriteriaFrom != "" && $scope.openareaTenderListFilter.dateCriteriaTo != ""){
				
				var javaScriptStartDate = $scope.openareaTenderListFilter.dateCriteriaFrom.toDate();
				var javaScriptEndDate = $scope.openareaTenderListFilter.dateCriteriaTo.toDate();
				
				if(javaScriptEndDate < javaScriptStartDate){
					bootbox.alert({ 
						size: "small",
						title: "Alert",
						message: msg5,
						callback: function(){}
					});
					$('#loading').hide();
					return;
				}else{
					$scope.openareaTenderListFilter.dateCriteriaFrom = $scope.openareaTenderListFilter.dateCriteriaFrom.format($scope.datePickerOption.format);
					$scope.openareaTenderListFilter.dateCriteriaTo = $scope.openareaTenderListFilter.dateCriteriaTo.format($scope.datePickerOption.format);
				}
			}
		}

		if(angular.isDefined($scope.openareaTenderListFilter.dateCriteriaId) && $scope.openareaTenderListFilter.dateCriteriaId != null){
			var errMsg = '';
			if((angular.isUndefined($scope.openareaTenderListFilter.dateCriteriaFrom) || $scope.openareaTenderListFilter.dateCriteriaFrom == '')
					|| (angular.isUndefined($scope.openareaTenderListFilter.dateCriteriaTo) || $scope.openareaTenderListFilter.dateCriteriaTo == '')){
				errMsg = msg4;
			}    		
			if(errMsg != ''){
				bootbox.alert({ 
					size: "small",
					title: "Alert",
					message: errMsg,
					callback: function(){}
				});
				$('#loading').hide();
				return;
			}    		
		}
	};


    $scope.tabClicked=function(tabId){
        console.log('test 2');
        $scope.cancelTab=false;
        $scope.pastTendersTab=false;
        if(angular.isDefined($scope.queryForm)){
            $scope.queryForm.$setPristine();
        }
        $scope.tenderF.currentdeptid="";
        $scope.tenderF.dateParam="";
        $scope.tenderF.gettingClosed="";
        $scope.tenderF.procatId="";
        $scope.tenderF.typeId="";
        $scope.tenderF.tenderClosed="";
        $scope.filterTender($scope.tenderFilter, $scope.tenderF.currentdeptid,$scope.tenderF.dateParam,$scope.tenderF.startDate,$scope.tenderF.endDate,$scope.tenderF.procatId,$scope.tenderF.typeId,$scope.tenderF.gettingClosed,$scope.tenderF.tendercancelled,$scope.tenderF.tenderClosed);
        $scope.broadcastFilter();
        switch(tabId){
            case 'latestTenders':
                 $scope.loadLatestTenders();
            break;
            case 'cancelTenders':
                $scope.cancelTab=true;
                $scope.loadCancelTenders();
            break;
            case 'corrigendumTenders':
                $scope.loadCorrigendumTenders();
            break;
            case 'upcomingTenders':
                $scope.loadUpcomingTenders();
            break;
            case 'pastTenders':
                $scope.pastTendersTab=true;
                $scope.loadPastTenders();
            break;
        }
    }
    $scope.loadLatestTenders=function(){
        $('#loading').show();
        var promise = $http({
            url: contextPath+'/rest/openarea/getTenderList',
            method: 'POST',
            data: $scope.openareaTenderListFilter
        });
        promise.then($scope.loadtenderList,function(err){
            $('#loading').hide();
            errorh.handelError(err.headers('errorMsg'),err.status);
            return;
        });
    }
	$scope.loadCancelTenders=function(){
	    if($scope.allCancelTenderList.length==0){
	        $('#loading').show();
            var promise = $http({
                url: contextPath+'/rest/openarea/getCancelTenderList',
                method: 'POST',
                data: $scope.openareaTenderListFilter
            });
            promise.then($scope.loadCancelTenderList,function(err){
                $('#loading').hide();
                errorh.handelError(err.headers('errorMsg'),err.status);
                return;
            });
	    }

	}

	$scope.loadCorrigendumTenders=function(){
    	    if($scope.alltenderWithCorrigendumList.length==0){
                $('#loading').show();
                var promise = $http({
                    url: contextPath+'/rest/openarea/getCorrigendumTenders',
                    method: 'POST',
                    data: $scope.openareaTenderListFilter
                });
                promise.then($scope.loadTenderWithCorrigendumList,function(err){
                    $('#loading').hide();
                    errorh.handelError(err.headers('errorMsg'),err.status);
                    return;
                });
            }
    	}
    $scope.loadUpcomingTenders=function(){
        if($scope.allupcomingtendersList.length==0){
            $('#loading').show();
            var promise = $http({
                url: contextPath+'/rest/openarea/getUpcommingTenders',
                method: 'POST',
                data: $scope.openareaTenderListFilter
            });
            promise.then($scope.loadUpcomingTendersList,function(err){
                $('#loading').hide();
                errorh.handelError(err.headers('errorMsg'),err.status);
                return;
            });
        }
    }
    $scope.loadPastTenders=function(){
        if($scope.allpasttendersList.length==0){
            $('#loading').show();
            var promise = $http({
                url: contextPath+'/rest/openarea/getPastTenders?startpoint=' + ($scope.pageIndex-1)*$scope.openAreaPastTendersListCount + '&maxRow='+ $scope.openAreaPastTendersListCount,
                method: 'POST',
                data: $scope.openareaTenderListFilter
            });
            promise.then($scope.loadPastTendersList,function(err){
                $('#loading').hide();
                errorh.handelError(err.headers('errorMsg'),err.status);
                return;
            });
        }
    }
    $scope.loadtenderList = function(tenderList){
            console.log('close loading');
            $('#loading').hide();
    		$scope.allTenderList = tenderList.data;
    		$scope.tenderList = tenderList.data;
    		angular.forEach($scope.showList, function(value, key) {
    			$scope.showList[key] = false;
    		});
    		$scope.showList[$scope.showListItem] = true;
    		//$scope.setupPagination($scope.orderByField);
    	};
	$scope.loadCancelTenderList = function(cancelTenderList){
	        $scope.allCancelTenderList = cancelTenderList.data;
    		$scope.cancelTenderList = cancelTenderList.data;
    		 $('#loading').hide();
	}

	$scope.loadTenderWithCorrigendumList = function(tenderWithCorrigendumList){
            $scope.alltenderWithCorrigendumList = tenderWithCorrigendumList.data;
            $scope.tenderWithCorrigendumList = tenderWithCorrigendumList.data;
             $('#loading').hide();
    }
    $scope.loadUpcomingTendersList = function(upcomingTendersList){
            $scope.allupcomingtendersList= upcomingTendersList.data;
            $scope.upcomingtendersList = upcomingTendersList.data;
             $('#loading').hide();
    }
    $scope.loadPastTendersList = function(pastTendersList){
            $scope.allpasttendersList= pastTendersList.data;
            $scope.pasttendersList = pastTendersList.data;
             $('#loading').hide();
    }

    $scope.broadcastFilter = function(list){
        $rootScope.$broadcast("filterChanged", list);
    }
    $scope.filterTender = function(tenderFilterText,deptId,dateParam,startDate,endDate,procId,rfqTypeId,gettingClosed,tendercancelled,tenderclosed){
        if(!dateParam){
            startDate=null;
            endDate=null;
            $scope.tenderF.startDate=null;
            $scope.tenderF.endDate=null;
        }else{
            $scope.tenderF.gettingClosed="";
        }
        var isFilterAllowed = true;
        $scope.openareaTenderListFilter.deptId=deptId;
        $scope.openareaTenderListFilter.dateParam=dateParam;
	    $scope.openareaTenderListFilter.startDate=startDate;
		$scope.openareaTenderListFilter.endDate=endDate;
		if(dateParam !=0 && startDate == null && endDate == null){
			isFilterAllowed = false;
		}
		if (angular.isDefined(tenderclosed) && tenderclosed != '') {

			if (tenderclosed == 0) {
				var fromDate = moment().subtract(tenderclosed,'days').startOf('day').valueOf();
				var toDate = moment().subtract(tenderclosed,'days').endOf('day').valueOf();
			}
			else {
				var fromDate = moment().subtract(tenderclosed, 'days').valueOf();
				var toDate = moment().valueOf();
			}
			if (fromDate != null && toDate != null) {
				isFilterAllowed = true;
			}
			$scope.openareaTenderListFilter.closeDateFrom = fromDate;
			$scope.openareaTenderListFilter.closeDateTo = toDate;
		}
		else {
			$scope.openareaTenderListFilter.closeDateFrom = '';
			$scope.openareaTenderListFilter.closeDateTo = '';
		}
        $scope.openareaTenderListFilter.procatId=procId;
        $scope.openareaTenderListFilter.typeId=rfqTypeId;
        
        if(angular.isDefined(tenderFilterText)){
			$scope.openareaTenderListFilter.textFilter=tenderFilterText;
		}
			
        if(isFilterAllowed == true &&  $scope.pastTendersTab == true){
            $('#loading').show();
            var promise = $http({
                url: contextPath+'/rest/openarea/getPastTenders?startpoint=' + ($scope.pageIndex-1)*$scope.openAreaPastTendersListCount + '&maxRow='+ $scope.openAreaPastTendersListCount,
                method: 'POST',
                data: $scope.openareaTenderListFilter
            });
            promise.then($scope.loadPastTendersList,function(err){
                $('#loading').hide();
                errorh.handelError(err.headers('errorMsg'),err.status);
                return;
            });
        }
        
        var filterObj = {currentdeptid:deptId,currentproccatid:procId,currenttendertypeid:rfqTypeId};
        $scope.tenderList = $filter('filterMultiple')($scope.allTenderList, filterObj);
        $scope.cancelTenderList = $filter('filterMultiple')($scope.allCancelTenderList, filterObj);
        $scope.tenderWithCorrigendumList = $filter('filterMultiple')($scope.alltenderWithCorrigendumList, filterObj);
        $scope.upcomingtendersList = $filter('filterMultiple')($scope.allupcomingtendersList, filterObj);
        //$scope.pasttendersList = $filter('filterMultiple')($scope.loadPastTendersList, filterObj);
        if(angular.isDefined(tenderFilterText)){
            $scope.tenderList = $filter('filter')($scope.tenderList, {$: tenderFilterText});
            $scope.cancelTenderList = $filter('filter')($scope.cancelTenderList, {$: tenderFilterText});
            $scope.tenderWithCorrigendumList = $filter('filter')($scope.tenderWithCorrigendumList, {$: tenderFilterText});
            $scope.upcomingtendersList = $filter('filter')($scope.upcomingtendersList, {$: tenderFilterText});
            //$scope.pasttendersList = $filter('filterMultiple')($scope.pasttendersList, {$: tenderFilterText});
        }
         if(angular.isDefined(dateParam) && dateParam!=''){
                if((angular.isDefined(startDate) && startDate!=null) || (angular.isDefined(endDate) && endDate!=null)){
                    $scope.tenderList = $filter('dateRange')($scope.tenderList, startDate,endDate,dateParam);
                    //$scope.cancelTenderList = $filter('dateRange')($scope.cancelTenderList, startDate,endDate,dateParam);
                    $scope.tenderWithCorrigendumList = $filter('dateRange')($scope.tenderWithCorrigendumList, startDate,endDate,dateParam);
                    $scope.upcomingtendersList = $filter('dateRange')($scope.upcomingtendersList, startDate,endDate,dateParam);
                    //$scope.pasttendersList = $filter('dateRange')($scope.pasttendersList, startDate,endDate,dateParam);
                }

         }
         if(angular.isDefined(gettingClosed) && gettingClosed!=''){
            $scope.tenderList = $filter('dateSpan')($scope.tenderList, gettingClosed,'latestTenders');
            $scope.tenderWithCorrigendumList = $filter('dateSpan')($scope.tenderWithCorrigendumList,gettingClosed,'corrigendumTenders');
            $scope.upcomingtendersList = $filter('dateSpan')($scope.upcomingtendersList,gettingClosed,'upcomingTenders');
         }
         if(angular.isDefined(tendercancelled) && tendercancelled!=''){
            $scope.cancelTenderList = $filter('dateSpan')($scope.cancelTenderList,tendercancelled,'cancelTenders');
         }
         if(angular.isDefined(tenderclosed) && tenderclosed!=''){
             //$scope.pasttendersList = $filter('dateSpan')($scope.pasttendersList,tenderclosed,'pastTenders');
          }
    }


	$scope.freeSearch = function(keyword){
		//$scope.tenderList = $filter('filter')($scope.allTenderList, {$: keyword});
		var arrFiltered =[];
		keyword = keyword.toLowerCase();
		angular.forEach($scope.allTenderList, function(value, key) {
			var c1 = '';
			var c2 = ''; 
			
			if(value.currentOrgTenderId != null &&  value.currentOrgTenderId != '' && value.currentOrgTenderId != undefined){
				c1=value.currentOrgTenderId.toString().toLowerCase();
			}
			if(value.currenttenderrefno != null &&  value.currenttenderrefno != '' && value.currenttenderrefno != undefined){
				c2=value.currenttenderrefno.toString().toLowerCase();;
			}
			//var c2 = value.currenttenderrefn.toString();
			if(c1.indexOf(keyword) != -1 || c2.indexOf(keyword) != -1 ){
				arrFiltered.push(value)
			}
		});
		$scope.tenderList = angular.copy(arrFiltered);
		$scope.setupPagination($scope.orderByField);
	}

	$scope.setupPagination = function(orderByField, reverseSort){
		$scope.reverseSort = reverseSort;
		$scope.gap = 5;		
		$scope.groupedItems = [];
		$scope.itemsPerPage = 30;
		$scope.pagedItems = [];
		$scope.currentPage = 0;
		if($scope.reverseSort){
			$scope.tenderList  = $filter('orderBy')($scope.tenderList, orderByField);
		}else{
			$scope.tenderList  = $filter('orderBy')($scope.tenderList, '-'+orderByField);
		}

		if($scope.tenderList.length/$scope.itemsPerPage > 5){
			$scope.gap = 5;
		}else{
			$scope.gap = Math.ceil($scope.tenderList.length/$scope.itemsPerPage);
		}
		$("#"+ $scope.currentSearchOption).modal("hide");
		$('#loading').hide();
		$scope.closeModal();
		$scope.groupToPages();
	};

	$scope.groupToPages = function () {
		$scope.pagedItems = [];        
		for (var i = 0; i < $scope.tenderList.length; i++) {
			if (i % $scope.itemsPerPage === 0) {
				$scope.pagedItems[Math.floor(i / $scope.itemsPerPage)] = [ $scope.tenderList[i] ];
			} else {
				$scope.pagedItems[Math.floor(i / $scope.itemsPerPage)].push($scope.tenderList[i]);
			}
		}
	};

	$scope.range = function (size,start, end) {
		var ret = [];                       
		if (size < end) {
			end = size;
			start = size-$scope.gap;
		}
		for (var i = start; i < end; i++) {
			ret.push(i);
		}
		return ret;
	};

	$scope.prevPage = function () {
		if ($scope.currentPage > 0) {
			$scope.currentPage--;
		}
	};

	$scope.nextPage = function () {
		if ($scope.currentPage < $scope.pagedItems.length - 1) {
			$scope.currentPage++;
		}
	};

	$scope.setPage = function () {
		$scope.currentPage = this.n;
	};

	$scope.closeModal = function(){
		$scope.openareaTenderListFilter = {};
		if(orgId != 0){
			$scope.openareaTenderListFilter.orgId = orgId;
		}		
		$scope.tempFilter = {};
		$scope.loadHeaderList = {};
		$scope.loadOrgInfoForAddNewOrg={};
		$scope.organization={};
	}
	
	$scope.clickForMoreTender = function(){
		if($scope.tenderList.length>$scope.openAreaLoadTendetListCount){
			$scope.openAreaLoadTendetListCount = $scope.openAreaLoadTendetListCount + 30;
		}
	}
	$scope.clickForMoreCancelTender = function(){
        if($scope.cancelTenderList.length>$scope.openAreaLoadCancelTenderListCount){
            $scope.openAreaLoadCancelTenderListCount = $scope.openAreaLoadCancelTenderListCount + 30;
        }
    }
    $scope.clickForMoreCorrigendumTenders = function(){
        if($scope.tenderWithCorrigendumList.length>$scope.openAreaLoadtenderWithCorrigendumListCount){
            $scope.openAreaLoadtenderWithCorrigendumListCount = $scope.openAreaLoadtenderWithCorrigendumListCount + 30;
        }
    }
    $scope.clickForMoreUpcomingTenders = function(){
        if($scope.upcomingtendersList.length>$scope.openAreaUpcomingTendersListCount){
            $scope.openAreaUpcomingTendersListCount = $scope.openAreaUpcomingTendersListCount + 30;
        }
    }
    $scope.clickForMorePastTenders = function(){
        if($scope.pasttendersList.length>=$scope.openAreaPastTendersListCount){
            $scope.openAreaPastTendersListCount = $scope.openAreaPastTendersListCount + 30;
            $scope.allpasttendersList=[];
            $scope.loadPastTenders();
        }
    }
	$scope.desibleToDate = false;
	$scope.changeDateCriteriaForSearch = function(dateCriteriaId){
		$scope.desibleToDate = true;
	}
	
	$scope.changeFromDate = function(){
		$scope.desibleToDate = false;
	}
	
	$scope.getJavaScriptDate = function(recvDate,deliMeter,dateInFormat){
		var splitDate = recvDate.split(deliMeter);
		var splitDateFormat = dateInFormat.split(deliMeter);
		var monthIndex=splitDateFormat.indexOf("mm");
		var dayIndex=splitDateFormat.indexOf("dd");
		var yearIndex=splitDateFormat.indexOf("yyyy");
		
		var returnDateString = splitDate[yearIndex]+"/"+splitDate[monthIndex]+"/"+splitDate[dayIndex];
		return new Date(returnDateString);
	}
	
	/*
	 * this function use for openarea tender preview popup open.
	 * created by manab sahoo
	 * created date:11-10-2017
	 */
	$scope.previewTender = function(tenderid, orgid) {
		$("#loading").show();
		$scope.activeTenderId=tenderid;
		$scope.orgId=orgid;
		
		var getTenderIdOfParentIdUrl = contextPath + '/rest/tender/getParentId?tenderId='+$scope.activeTenderId;
			$http.post(getTenderIdOfParentIdUrl).then(function(res){
				$scope.tenderIdOfParent = res.data;

			},function(error){
				console.log(error);
			});
		
		utilityService.getorgConfigDetailsById($scope.orgId).then(function(res){
			
			if(res){
				$rootScope.configurationSettings = res;
				if(res.masterDateFormatDesc == null || res.masterTimeFormatDesc == null){
					var defultSettingUrl= contextPath+"/rest/master/getDefaultDateTimeFormat";
					var defultSettingRes = $http.post(defultSettingUrl);
					defultSettingRes.success(function(res1){
						if(res1.dateTimeFormat){
							$rootScope.configurationSettings.masterDateFormatDesc=res1.dateTimeFormat.split(" ")[0];
							$rootScope.configurationSettings.masterTimeFormatDesc=res1.dateTimeFormat.split(" ")[1] +" "+res1.dateTimeFormat.split(" ")[2];
							
							$rootScope.configurationSettings.orgConfigDateTimePickerFormat = $rootScope.configurationSettings.masterDateFormatDesc.toUpperCase()+" "+ $rootScope.configurationSettings.masterTimeFormatDesc; 
							$rootScope.configurationSettings.orgConfigDatePickerFormat = $rootScope.configurationSettings.masterDateFormatDesc.toUpperCase(); 
							$rootScope.configurationSettings.orgConfigDateTimeFormatForAngular = $rootScope.configurationSettings.masterDateFormatDesc + (($rootScope.configurationSettings.masterTimeFormatDesc=="hh:mm a") ? ' hh:mm a' : ' HH:mm');
						}
						if($rootScope.configurationSettings.pacVisibilityFlag=='Y')
						{
							$scope.isPacValShow=true;
						}
						else{
							$scope.isPacValShow=false;
						}
						tenderQuickView(tenderid);
					});
					defultSettingRes.error(function(err) {
						$('#loading').hide();
						utilityService.handelError(err.headers('errorMsg'),err.status);
					});					
				}else{
					if($rootScope.configurationSettings.pacVisibilityFlag=='Y')
					{
						$scope.isPacValShow=true;
					}
					else{
						$scope.isPacValShow=false;
					}
					tenderQuickView(tenderid);
				}
			}else{
				$("#loading").hide();
			}
		},function(err){
			$("#loading").hide();
			utilityService.handelError(err.headers('errorMsg'),err.status);
		})
		
	};
	
	 $scope.previewTenderOfParent = function(tenderId){
        	$scope.previewDestinationObj = {};
                $scope.showVendorDetailsLink = true;
                $scope.vendorNameList = "";
                $scope.previewTenderFinalData = {};
                $scope.previewData = [];
                $scope.previewDestinationObj.previewDestination = "";
                $scope.previewDestinationObj.showInvitedVendor = true;
                $scope.isPacValShow = true;
                if(tenderId == 0){
                bootbox.alert({
				  size: "small",
				  title: "Alert",
				  message: "This Tender does not have parent Id.",
				  callback: function(){
				  }
				});
			  return;
                }
                $("#loading").show();
    			var getPreviewTenderOfParentUrl = contextPath +'/rest/tender/previewTenderByTenderId?tenderId='+tenderId;
    			$http.post(getPreviewTenderOfParentUrl).then(function(res){
    				$scope.previewParentTender = res.data;
    				
    				 $scope.previewParentTender.description = (($scope.previewParentTender.description.split(/\r|\n/.exec($scope.previewParentTender.description))).join('</br>')).replace(/ /g, '\u00a0');
    	                if ($scope.previewParentTender.tendertypeid != 101 && $scope.previewParentTender.tendertypeid != 106 && $scope.previewParentTender.tendertypeid != '') {
    	                    $scope.previewParentTender.limitedTenderReason = (($scope.previewParentTender.limitedTenderReason.split(/\r|\n/.exec($scope.previewParentTender.limitedTenderReason))).join('</br>')).replace(/ /g, '\u00a0');
    	                }
    	                
    	                // if(configurationSettings.nitRequired=='Y'){
    	                $scope.previewParentTender.nit = (($scope.previewParentTender.nit.split(/\r|\n/.exec($scope.previewParentTender.nit))).join('</br>')).replace(/ /g, '\u00a0');
    	                // }

    	                if (angular.isDefined($scope.previewParentTender.pacamt) && $scope.previewParentTender.pacamt != null) {
    	                    $scope.previewParentTender.pacamt = $scope.previewParentTender.pacamtAsString;
    	                }
    	                $scope.vendorNameListArr = [];
    	                angular.forEach($scope.previewParentTender.tenderPreviewMap.invitedVendors, function(vendor) {
    	                    if ($scope.vendorNameList.length == 0) {
    	                        $scope.vendorNameList = vendor.vendorOrg;
    	                    } else {
    	                        $scope.vendorNameList = $scope.vendorNameList + " , " + vendor.vendorOrg;
    	                    }
    	                    $scope.vendorNameListArr.push(vendor);
    	                });
    	                $scope.previewParentTender.vendorNameList = $scope.vendorNameList;
    	                $scope.previewParentTender.vendorNameListArr = $scope.vendorNameListArr;
    	                angular.forEach($scope.previewParentTender.templates, function(element) {
    	                    if (element.shortName == "rfqattachment" || element.shortName == "requiredbidderattachment" || element.templateTypeId == 103) {
    	                        angular.forEach(element.templateFieldList, function(field, key) {
    	                            if (field.code == "bidder_selection") {
    	                                var str = "";
    	                                if (field.value != "" && field.value != null && field.value != undefined) {
    	                                    angular.forEach(field.value.split(","), function(item, key1) {
    	                                        angular.forEach($scope.previewParentTender.tenderVendors, function(vendor, vnKey) {
    	                                            if (parseInt(vendor.vendorId) == parseInt(item)) {
    	                                                if (key1 == field.value.split(",").length - 1)
    	                                                    str = str + vendor.vendorOrg;
    	                                                else
    	                                                    str = str + vendor.vendorOrg + ",";
    	                                            }
    	                                        })
    	                                    })
    	                                }
    	                                field.value = str;
    	                            }
    	                        });
    	                    }

    	                    if ($scope.previewTenderFinalData.hasOwnProperty(element.templategroupId) == false) {
    	                        $scope.previewTenderFinalData[element.templategroupId] = [];

    	                        if (element.displayLayoutid == '102') {
    	                            var tabularHeader = {};
    	                            angular.forEach(element.templateFieldList, function(field) {
    	                                if (field.isVisible == 'Y' && field.roleWiseFieldEntry != 'H') {
    	                                    tabularHeader[field.shortName] = field.longName;
    	                                }
    	                            });
    	                            $scope.previewTenderFinalData[element.templategroupId].push(tabularHeader);
    	                        }
    	                    }
    	                    $scope.previewTenderFinalData[element.templategroupId].push(element);
    	                });

    	                var obj = [];
    	                for (var x in $scope.previewTenderFinalData) {
    	                    $scope.previewTenderFinalData.hasOwnProperty(x) && obj.push($scope.previewTenderFinalData[x])
    	                }
    	                for (var i = 0; i < obj.length; i++) {
    	                    for (var j = i + 1; j < obj.length; j++) {
    	                        var sequence1, sequence2;
    	                        if (obj[i].length == 1) {
    	                            sequence1 = obj[i][0].displaySequenceNo;
    	                        } else {
    	                            sequence1 = obj[i][1].displaySequenceNo;
    	                        }
    	                        if (obj[j].length == 1) {
    	                            sequence2 = obj[j][0].displaySequenceNo;
    	                        } else {
    	                            sequence2 = obj[j][1].displaySequenceNo;
    	                        }

    	                        if (sequence1 > sequence2) {
    	                            var temp = obj[i];
    	                            obj[i] = obj[j];
    	                            obj[j] = temp;
    	                        }
    	                    }
    	                }
    	                $scope.previewData = obj;
    	                for (var i = 0; i < $scope.previewData.length; i++) {
    	                    if ($scope.previewData[i].length > 1) {
    	                        var isRfqItems = $scope.previewData[i][1].templateTypeId;
    	                        if (isRfqItems == 103) {
    	                            var tempItem = [];
    	                            tempItem.push($scope.previewData[i][0]);
    	                            $scope.previewData[i].shift();
    	                            $scope.previewData[i] = tempItem.concat(utilityService.sortRfqItems($scope.previewData[i]));
    	                        }
    	                    }
    	                }
    	                $("#modelPreviewForParent").modal("show");
    	                $("#loading").hide();


    			},function(err){
    				utilityService.handelError(err.headers('errorMsg'), err.status);
                    $("#loading").hide();
    			});
    	}
	
	$scope.previewDestinationObj = {};
	var tenderQuickView = function(tenderid){
		
		$scope.previewTenderFinalData = {};
		$scope.organizationHircy = {};
		$scope.vendorNameList ="";
		$scope.loader = true;
		$scope.organizationHircy.orgDetailsInASingleProperty = "";
		$scope.previewDestinationObj.previewDestination = "";
		$scope.previewDestinationObj.showInvitedVendor = false;
		var tenpreviewList = $http.post(contextPath+'/rest/quotation/previewTenderByTenderId?tenderId='+tenderid);
		tenpreviewList.success(function(response) {
			$("#loading").hide();
			$scope.previewTenderData = response;
			$scope.previewTenderData.description = (($scope.previewTenderData.description.split(/\r|\n/.exec($scope.previewTenderData.description))).join('</br>')).replace(/ /g, '\u00a0');
			angular.forEach($scope.previewTenderData.tenderPreviewMap.invitedVendors, function(vendor) {
				if($scope.vendorNameList.length == 0){
					$scope.vendorNameList = vendor.vendorOrg;
				}else{
					$scope.vendorNameList = $scope.vendorNameList +" , "+ vendor.vendorOrg;
				}
				
			});
			if($scope.previewTenderData.pacVisibilityFlag != null && $scope.previewTenderData.pacVisibilityFlag != ''){
				if($scope.previewTenderData.pacVisibilityFlag=='Y')
				{
					$scope.isPacValShow=true;
				}
				else{
					$scope.isPacValShow=false;
				}
			}
			$scope.previewTenderData.vendorNameList = $scope.vendorNameList;
			for(key in $scope.previewTenderData.tenderPreviewMap.creatorDetail.OrgHirarchy){
    			if($scope.organizationHircy.orgDetailsInASingleProperty.length == 0){
    				$scope.organizationHircy.orgDetailsInASingleProperty = $scope.previewTenderData.tenderPreviewMap.creatorDetail.OrgHirarchy[key]
    			}else{
    				$scope.organizationHircy.orgDetailsInASingleProperty = $scope.organizationHircy.orgDetailsInASingleProperty +"->" + $scope.previewTenderData.tenderPreviewMap.creatorDetail.OrgHirarchy[key];
    			}
    			
    		}
			
			var invitedVendorString="";
			if($scope.previewTenderData.tenderPreviewMap.hasOwnProperty('invitedVendors')){
				for(var pos=0; pos < $scope.previewTenderData.tenderPreviewMap['invitedVendors'].length;pos++){
					if(pos == $scope.previewTenderData.tenderPreviewMap['invitedVendors'].length-1){
						invitedVendorString += $scope.previewTenderData.tenderPreviewMap['invitedVendors'][pos].vendorOrg;
					}else{
						invitedVendorString += $scope.previewTenderData.tenderPreviewMap['invitedVendors'][pos].vendorOrg+", ";
					}
				}
			}
			if(invitedVendorString.length > 0){
				$scope.previewTenderData["tenderPreviewMap"]["invitedVendorsOrgNames"]=invitedVendorString;
			}
			console.log("string",invitedVendorString);				
			
			angular.forEach($scope.previewTenderData.templates, function(element) {
				if($scope.previewTenderFinalData.hasOwnProperty(element.templategroupId)==false){
					$scope.previewTenderFinalData[element.templategroupId] = [];					
					if(element.displayLayoutid == '102'){
						var tabularHeader = {};
						angular.forEach(element.templateFieldList, function(field){
							if(field.isVisible == 'Y' && field.roleWiseFieldEntry != 'H'){
								tabularHeader[field.shortName] = field.longName;
							}
						});
						$scope.previewTenderFinalData[element.templategroupId].push(tabularHeader);
					}
				}
				$scope.previewTenderFinalData[element.templategroupId].push(element);				
			});
			var obj = [];
			for (var x in $scope.previewTenderFinalData){
				$scope.previewTenderFinalData.hasOwnProperty(x) && obj.push($scope.previewTenderFinalData[x])
			}
			for(var i=0 ; i < obj.length; i++){
				for(var j=i+1 ; j < obj.length; j++){
					var sequence1, sequence2;
					if(obj[i].length == 1){
						sequence1 = obj[i][0].displaySequenceNo;
					}else{
						sequence1 = obj[i][1].displaySequenceNo;
					}
					if(obj[j].length == 1){
						sequence2 = obj[j][0].displaySequenceNo;
					}else{
						sequence2 = obj[j][1].displaySequenceNo;
					}
					
					if(sequence1 > sequence2){
						var temp = obj[i];
						obj[i] = obj[j];
						obj[j] = temp;
					}
				}
			}
			$scope.previewData = obj;
			for(var i = 0; i< $scope.previewData.length; i++){
				if($scope.previewData[i].length > 1){
					var isRfqItems = $scope.previewData[i][1].templateTypeId;
					if(isRfqItems == 103){
						var tempItem = [];
						tempItem.push($scope.previewData[i][0]);
						$scope.previewData[i].shift();
						$scope.previewData[i] = tempItem.concat(utilityService.sortRfqItems($scope.previewData[i]));
					}
				}
			}
			
			/*if($scope.previewData.length > 3){
				$scope.previewData.splice(3, $scope.previewData.length-3);
			}*/
			
			$scope.loader = false;
			$("#myModalprev").modal("show");
			$("#loading").hide();
		});

		tenpreviewList.error(function(data, status, headers, config) {
			errorh.handelError(renderErrorMsg(headers('errorMsg')) ,status);
			$("#loading").hide();
			$scope.loader = false;
		});
	}
	
	$scope.getLength = function(fileName){
		return fileName.split('|').length;		
	};
	
	$scope.viewPoPreview= function(tender){
		$scope.selectedTender = tender;
		$scope.viewPop($scope.selectedTender.currenttenderid); // orgpoId
	}
	
	$scope.viewPop = function(tenderId){ //orgpoId
		$("#loading").show();
	    	var getPoDetailsForPastTender = contextPath+ '/rest/openarea/getPoDetailsForPastTender?tenderId='+parseInt(tenderId);
	    	var httpResponseData=$http.post(getPoDetailsForPastTender);
	    	httpResponseData.then(function(res){
	    		$scope.poDetail=res.data;
	    		
				if ($scope.poDetail == "") {
					$("#loading").hide();
					bootbox.alert({
						size: "small",
						title: "Alert",
						message: "This Tender does not have Po.",
						callback: function() {
						}
					});
					return;
				}
				else {
					$("#editpoMdl").modal("show");
					$("#loading").hide();
					//$scope.releasePoBtn = false;
					prepareTemplateDataForPo($scope.poDetail.epspoId);
				}
	    	}, function(err){
	    	    $("#loading").hide();
	    		utilityService.handelError(err.headers('errorMsg'),err.status);
	    	});	
	}
	
	var prepareTemplateDataForPo = function(poId){
    	$scope.activePo={
    			"poId":poId
	    };
    	$scope.templateTabs = [];             		
    	$scope.templateFormModels= []; 
    	$scope.templateData = {};
    	$rootScope.orgAttachObj = {}; 
    	$rootScope.datePickerSettings={};
	    	
    	for(var process in $scope.poDetail.templateMap){
			angular.forEach($scope.poDetail.templateMap[process], function(template, index){
	    		angular.forEach(template.templateFieldList, function(field, index){
	    			if(field.controlTypeId==105){
	    				if(field.value==null){
	    					field.value=[];
	    				}else{
	    					field.value=field.value.split(',');
	    				}
	    				
	    			}
	    			
	    			if($scope.poDetail.integratedFlag=='Y')
	    				field["isEnabled"]='N';
	    			
	    		});
	    	});
		}
		
		if($scope.poDetail.templateMap){
			for(var process in $scope.poDetail.templateMap){
    			$scope.templateTabs.push({
    				templategroupId : $scope.poDetail.templateMap[process][0].poTemplateId,
    				shortName: $scope.poDetail.templateMap[process][0].shortName,
    				longName: $scope.poDetail.templateMap[process][0].subProcessName,
    				displaySequenceNo: $scope.poDetail.templateMap[process][0].displaySequenceNo
    			});
    			
    			
    			if($scope.templateData[$scope.poDetail.templateMap[process][0].shortName] == undefined)
    				$scope.templateData[$scope.poDetail.templateMap[process][0].shortName] = {};
    				
    			$scope.templateData[$scope.poDetail.templateMap[process][0].shortName]['data'] = angular.copy(timeStamp($scope.poDetail.templateMap[process]));
    			$scope.templateData[$scope.poDetail.templateMap[process][0].shortName]['displayLayoutid'] = $scope.poDetail.templateMap[process][0].displayLayoutid;
    			$scope.templateData[$scope.poDetail.templateMap[process][0].shortName]['sampleData'] = fieldValueBlank(angular.copy($scope.poDetail.templateMap[process][0]));
				$scope.templateData[$scope.poDetail.templateMap[process][0].shortName]['displaySequenceNo']=$scope.poDetail.templateMap[process][0].displaySequenceNo;
				$scope.templateData[$scope.poDetail.templateMap[process][0].shortName]['templateTypeId']=$scope.poDetail.templateMap[process][0].templateTypeId;
    			
				$scope.templateData[$scope.poDetail.templateMap[process][0].shortName]['fields'] = {};	
    			/*if(_aggregationData[$scope.poDetail.templateMap[process][0].shortName] === undefined) {
  				  _aggregationData[$scope.poDetail.templateMap[process][0].shortName] = {};				  
  			  	}*/
  			  angular.forEach($scope.poDetail.templateMap[process][0].templateFieldList, function(field, fieldIndex) {
				if( $scope.templateData[$scope.poDetail.templateMap[process][0].shortName]['fields'][field.shortName] === undefined ) {
					$scope.templateData[$scope.poDetail.templateMap[process][0].shortName]['fields'][field.shortName] = {};
					$scope.templateData[$scope.poDetail.templateMap[process][0].shortName]['fields'][field.shortName]['hasAggregation'] = ((field.isAggregation == 'Y') ? true : false);
					$scope.templateData[$scope.poDetail.templateMap[process][0].shortName]['fields'][field.shortName]['aggregationValues'] = [];
					$scope.templateData[$scope.poDetail.templateMap[process][0].shortName]['fields'][field.shortName]['aggregationResult'] = 0;
					$scope.templateData[$scope.poDetail.templateMap[process][0].shortName]['fields'][field.shortName]['fieldIndex'] = fieldIndex;
				}
  			  });
    			
			}
			
			$scope.templateTabs = $filter('orderBy')($scope.templateTabs, 'displaySequenceNo');
			
			//$scope.templateTabs = $filter('orderBy')($scope.templateTabs, 'displaySequenceNo');
	//template content object prepar
    		var templateArrayData = [];
    		
    		for(var process in $scope.poDetail.templateMap){
				templateArrayData = $scope.poDetail.templateMap[process];
    			var templateModel = angular.copy(templateArrayData[0]);   		
        		$scope.templateFormModels.push(angular.copy(templateModel));
        		var indexOfFormModel = $scope.templateFormModels.length - 1;
        		
        		// for input file prepare object
        		var shortName = (($scope.poDetail.templateMap[process] != null && $scope.poDetail.templateMap[process] instanceof Array) ? $scope.poDetail.templateMap[process][0].shortName : false);
        		
         		if($rootScope.orgAttachObj[shortName]==undefined){
         			$rootScope.orgAttachObj[shortName] = [];
         		}else{
         			$rootScope.orgAttachObj[shortName] = [];
         		}
        		angular.forEach($scope.poDetail.templateMap[process], function(template, templateIndex){	
        			var obj = {};
        			angular.forEach(template.templateFieldList, function(field, fieldIndex){
        				if(field.controlTypeId == 108){			
							obj[field.shortName] = field.value;
        				}
        				
        				// for check box group
        				if(field.controlTypeId == 109){		
         					if($rootScope.groupCheckboxObj[template.shortName + "." + field.shortName+ "." + templateIndex]==undefined){
         						$rootScope.groupCheckboxObj[template.shortName + "." + field.shortName+ "." + templateIndex]={};
             					$rootScope.groupCheckboxObj[template.shortName + "." + field.shortName+ "." + templateIndex]["listvalue"]=field.listValues.split(",");
             					$rootScope.groupCheckboxObj[template.shortName + "." + field.shortName+ "." + templateIndex]["setvalue"]=[];
         					}else{
         						$rootScope.groupCheckboxObj[template.shortName + "." + field.shortName+ "." + templateIndex]={};
             					$rootScope.groupCheckboxObj[template.shortName + "." + field.shortName+ "." + templateIndex]["listvalue"]=field.listValues.split(",");
             					$rootScope.groupCheckboxObj[template.shortName + "." + field.shortName+ "." + templateIndex]["setvalue"]=[];
         					}
         					
         				}
        			});
        			$rootScope.orgAttachObj[template.shortName].push(obj);
        		});
        		
        		if($scope.templateFormModels[indexOfFormModel].displayLayoutid != 102) {
        			$scope.templateFormModels[indexOfFormModel] = templateArrayData[0];         			
        		} else {
        			var isEmpty = isEmptyRow(templateArrayData[0]);
        			if(templateArrayData.length > 0){
        				var row = angular.copy(templateArrayData[0]);
				  		if(!isEmpty) {
				  			angular.forEach(row.templateFieldList, function(field){
				  				field.value = '';
				  			});
				  			$scope.templateData[$scope.poDetail.templateMap[process][0].shortName]['data'] = angular.copy(templateArrayData);
				  		} else {
				  			$scope.templateData[$scope.poDetail.templateMap[process][0].shortName]['data'] = [];
				  		}
				  		$scope.templateData[$scope.poDetail.templateMap[process][0].shortName]['sampleData'] = row;	
        			}
        		}
        		
			}
		}		
		
    	/*original attachment download*/
		var originalAttachment = $scope.templateData[$scope.poDetail.templateMap[112][0].shortName].data.find(function(attachment){ //112 for PO attachment template
			return attachment.isOriginal == 'Y';
		});
		$scope.templateData[$scope.poDetail.templateMap[108][0].shortName]['originalAttachment'] = originalAttachment;
		var temp = [];		
		angular.forEach($scope.templateData, function(template){
			temp.push(template);
		});
		
		$scope.templateData = angular.copy(temp);
		$scope.templateData.sort(function(template1, template2){ return template1.displaySequenceNo - template2.displaySequenceNo;});
    }
    
     var timeStamp= function(templates){
		 var templatesArray=templates;
		 angular.forEach(templates,function(elem, index){
			 angular.forEach(elem.templateFieldList, function(field,index){
				if(field.controlTypeId == 104 && field.value != null && field.value != '' || field.controlTypeId == 110 && field.value != null && field.value != '') {
					field.value = moment(new Date(parseInt(field.value)));
				 }
			 });
		 });
		 
		 return templatesArray;
	 }
	 
	 var fieldValueBlank = function(data) {
		angular.forEach(data.templateFieldList, function(field) {
			if(field.shortName){
				field.value = '';
			}
		});
		return data;
	}
	var isEmptyRow = function(template) {
		  var flag = true;
		  for(var x = 0; x < template.templateFieldList.length; x++){
			  if( ( template.templateFieldList[x].value != ''  && 
					template.templateFieldList[x].value != null ) ){
				  flag = false;				  
			  }
		  }	  
		  return flag;
	 };
	 
	 $scope.chekVisableOrNot= function(field){
    	return field.isVisible == 'Y' ? true : false;
    }
	
	$scope.printTable = function(modalBody){
		var printContent = $( "."+modalBody).html();
       	var htmlToPrint = '' +
					        '<style type="text/css">' +
					        'table th, table td {' +
					        'border:1px solid #000;' +
					        'padding;0.5em;' +
					        '}' +
					        '</style>';
		htmlToPrint += printContent;
           var windowUrl = 'Template Preview';
           var uniqueName = new Date();
           var windowName = 'Print' + uniqueName.getTime();
           var printWindow = window.open(windowUrl, windowName, 'left=50000,top=50000,width=0,height=0');
           printWindow.document.write(htmlToPrint);
           printWindow.document.close();
           printWindow.focus();
           printWindow.print();
           printWindow.close();
	}
$scope.getCancelTenderHistory=function(tenderId){
	    	$("#loading").show();
	    	var approvalId = 0;
	    	var canTenderHistoryURL=contextPath+'/rest/canceltender/showCancelTenderHistory?tenderId='+tenderId;
	    	var approvarsListURL = contextPath+ '/rest/tenderApproval/getApprovalHistory?documentId='+tenderId+'&documentType=8';
	    	// var
			// approvarsListURL=contextPath+'/rest/approval/getUserListParticularEntityApproved?entityId='+entityId+'&moduleType='+$window.cancelTenderModule+'&approvalId='+approvalId;

	    	var httpResponseData=$http.post(canTenderHistoryURL);
	    	httpResponseData.then(function(res){
	    		$scope.cancelTender=res.data;

		    	var httpApproversListData=$http.post(approvarsListURL);
		    	httpApproversListData.then(function(res){
		    		$scope.cancelTender.listApprover=[];
		    		for(var i=0;i<res.data.length;i++){
		    			for(var k=0;k<res.data[i].approvalDetails.length;k++){
		    				$scope.cancelTender.listApprover.push(res.data[i].approvalDetails[k]);
		    			}
		    		}

		    	}, function(err){
		    		utilityService.handelError(err.headers('errorMsg'),err.status);
		    	});

		    	$("#loading").hide();
		    	$("#cancelTenderHistoryModal").modal('show');
	    	}, function(err){
	    	    $("#loading").hide();
	    		utilityService.handelError(err.headers('errorMsg'),err.status);
	    	});

	    }
	$scope.downloadFile = function(tenderId, templateGroupId, filename,isDownloadPossible){
    		//$("#loading").show();
    		$scope.listUserId=[];
    		$scope.interestFlag = 'N';
            $scope.signTenderbtn=true;
    		$scope.template=$scope.previewTenderData.templates;
            $scope.tenderIdval=tenderId;

    		 angular.forEach($scope.template, function(item){
    			 if(item.shortName=='rfqattachment' && item.isDownloadPossible=='N')
    				{
    				 	item.selected = true;
    				}
    		 });

    		 for (var i = 0; i < $scope.template.length; i++) {
    			if($scope.template[i].shortName=='rfqattachment' && $scope.template[i].isDownloadPossible=='N')
    			{
    		    if ($scope.template[i].selected) {
    		    	 $scope.multivalue=parseInt($scope.template[i].indexSerialNo);
    		         $scope.listUserId.push($scope.multivalue);
    		   }
    		    else{
    		    	$scope.listUserId.splice($scope.listUserId.indexOf($scope.multivalue), 1);
    		     }
    		  }
    		 }
    	     console.log("multiple",$scope.listUserId);

    		if((loggedUserId!=null || loggedUserId != undefined || loggedUserId!='') && isDownloadPossible=='N'){
    			//console.log("TENDERBIDDER DOWNLOAD====",loggedUserId,isDownloadPossible);
    			 //$("#myModalprev").modal("hide");
    			 $("#loading").show();

    			 //console.log('ARRAY',$scope.listUserId);
    			 $("#attachmentsignviewModal").modal("show");
    			 $("#loading").hide();
    			 $http.post(contextPath+'/rest/tenderResponseVendor/viewNDADisclaimer').then(function(res) {
    		  			$scope.disclaimerText = res.data;
    		  		});

    		}
    		else{
    			if($scope.activeTenderId && templateGroupId && filename){
    				var data={
    						"tempGrpId":templateGroupId,
    						"tenderId":parseInt(tenderId),
    						"fileName":filename,
    						"orgId":parseInt($window.orgId)
    				};
    				var url = contextPath + '/rest/openarea/downloadattachment' ;
    				if(filename.includes(EBRIEFCASE_ID)){
    		    		url = contextPath + '/rest/ebriefcase/downloadeBriefcase';
    		    	}
    				utilityService.downloadAttachmentFile(url, data);
    			}
    		}


    	};
    	
    	$scope.downloadCorrTenderAttachment = function(corrId){
		var data = {corrId: corrId};
		var url = contextPath+'/rest/corrigendum/downloadattachment';
		utilityService.downloadAttachmentFile(url, data);
	}
	
	$scope.downloadCorrTenderExternalAttachment = function(corrId){
		var data = {corrId: corrId};
		var url = contextPath+'/rest/corrigendum/downloadexternalattachment';
		utilityService.downloadAttachmentFile(url, data);
	}
    	
       	$scope.downloadCancelTenderAttachment = function(tenderId){
            var data = {"tenderId": tenderId};
            var url = contextPath+'/rest/canceltender/downloadattachment';
            utilityService.downloadAttachmentFile(url, data);
        }
        $scope.corrigendumQuickView = function(tenderId){
            // corrigendum view modal.
            $('#loading').show();
            var corrigendumViewUrl= contextPath+'/rest/corrigendum/getPublishedCorrigendumByTenderId?tenderId='+tenderId;
            var corrigendumViewList = $http.post(corrigendumViewUrl);

            corrigendumViewList.then(function(res){
                $scope.corriView=res.data;
                $scope.corriView=$filter('orderBy')($scope.corriView, "createdate", false);
               $('#loading').hide();
               $("#myModaliview").modal('show');
            }, function(err) {
                $('#loading').hide();
                utilityService.handelError(err.headers('errorMsg'),err.status);
            });
        }
        $scope.corrigendumViewHistory = function(corriId){
            // corrigendum view history.
            $scope.corriModule=$window.corrigendumModule;
            $('#loading').show();
            var corrigendumHistoryUrl= contextPath+'/rest/corrigendum/getCorrigendumById?corrId='+corriId;
            var corrigendumHistoryList = $http.post(corrigendumHistoryUrl);

            corrigendumHistoryList.then(function(res){
                var historyData=res.data;
                $scope.historyObj=historyData;
                var approvalId = 0;
    /*
     * var approverHistoryUrl=
     * contextPath+'/rest/approval/getUserListParticularEntityApproved?entityId='+corriId+'&moduleType='+$scope.corriModule+'&approvalId='+approvalId;
     */
                // var approverHistoryUrl = contextPath+
                // '/rest/corrigendum/getCorigendumApprovalHistory?documentId='+corriId+'&documentType=3';
                var approverHistoryUrl = contextPath+ '/rest/tenderApproval/getApprovalHistory?documentId='+corriId+'&documentType=3';
                var approverHistoryList = $http.post(approverHistoryUrl);
                approverHistoryList.then(function(res){
                    $scope.approverHistory={};
                    if(res.data.length > 0){
                        //var data=res.data[0].approvalDetails;
                        var data=res.data;
                        $scope.approverHistory=data;
                    }
                    $('#loading').hide();
                    $("#myModalihistory").modal('show');
                }, function(err) {
                    $('#loading').hide();
                    utilityService.handelError(err.headers('errorMsg'),err.status);
                });
            }, function(err) {
                $('#loading').hide();
                utilityService.handelError(err.headers('errorMsg'),err.status);
            });

        }
      $scope.corrigendumReport = function(corrigendumId){
      		// corrigendum view report.
      		$("#loading").show();
      		$scope.reportCorrigendumFinalData = {};
      		var corrigendumReportUrl= contextPath+'/rest/corrigendum/corrigendumReport?corrId='+corrigendumId;
      		var corrigendumReportList = $http.post(corrigendumReportUrl);

      		corrigendumReportList.then(function(response){
      			$scope.reportCorrigendumData = response.data;
      			console.log($scope.reportCorrigendumData );
      			if(angular.isDefined($scope.reportCorrigendumData["new"].pacamt) && $scope.reportCorrigendumData["new"].pacamt != null){
      				$scope.reportCorrigendumData["new"].pacamt = $scope.reportCorrigendumData["new"].pacamtAsString;
          		}
      			if(angular.isDefined($scope.reportCorrigendumData["old"].pacamt) && $scope.reportCorrigendumData["old"].pacamt != null){
      				$scope.reportCorrigendumData["old"].pacamt = $scope.reportCorrigendumData["old"].pacamtAsString;
          		}

      			for(var key in $scope.reportCorrigendumData){
      				if($scope.reportCorrigendumFinalData.hasOwnProperty(key)==false){
      					$scope.reportCorrigendumFinalData[[key]]={};
      			// prepare general info
      					$scope.reportCorrigendumFinalData[key]["genInfo"]={};
      					for(var genInfo in $scope.reportCorrigendumData[key]){
      						if(genInfo!=="templates"){
      							$scope.reportCorrigendumFinalData[key]["genInfo"][genInfo];
      							$scope.reportCorrigendumFinalData[key]["genInfo"][genInfo]=$scope.reportCorrigendumData[key][genInfo];
      						}

      					}

      					angular.forEach($scope.reportCorrigendumData[key].templates, function(element) {

      						if(element.shortName=='delivery_schedule')
      						{
      						  angular.forEach(element.templateFieldList, function(field){

      							  if(field.shortName == 'item_code'){
      								  if(field.value!=null)
      		            				{
      		            				 $scope.splitval=field.value.split("__");
      		            				 field.value=$scope.splitval[1];

      		            				}
      							  }

      						   });
      						}



      						if(element.shortName=="rfqattachment" || element.shortName=="requiredbidderattachment" || element.templateTypeId==103){
      							angular.forEach(element.templateFieldList, function(field,keyf){
      								if(field.code=="bidder_selection" && field.value != null && field.value != ''){
      									var str="";
      									angular.forEach(field.value.split(","),function(item,key1){
      										if($scope.reportCorrigendumFinalData[key]["genInfo"]["tenderVendors"] !=null && $scope.reportCorrigendumFinalData[key]["genInfo"]["tenderVendors"].length > 0){
      											// angular.forEach($scope.previewTenderData.tenderVendors,
      											// function(vendor,vnKey){
      											angular.forEach($scope.reportCorrigendumFinalData[key]["genInfo"]["tenderVendors"], function(vendor,vnKey){
      												if(parseInt(vendor.vendorId)==parseInt(item)){
      													if(key1==field.value.split(",").length - 1)
      														str=str+vendor.vendorOrg;
      													else
      														str=str+vendor.vendorOrg+",";
      												}
      											})
      										}
      									})
      									field.value=str;
      								}
      							});
      						}

      						// if(element.displayLayoutid == '102' &&
      						// element.shortName == 'rfqattachment'){

      							angular.forEach(element.templateFieldList, function(field){
      								if(field.controlTypeId == 108){
      									if(field.value!=null && field.value != ""){
      										var filepathArraySplit = field.value.split("|");
      										field.value = filepathArraySplit[filepathArraySplit.length-1];
      									}else{
      										field.value="";
      									}

      								}
      							});
      				  // added for whole number
      					        var itemcount=0;
      							angular.forEach(element.templateFieldList, function(field){
      									if(field.value!=null && field.value != "" && field.code=="item_qty"){
      									var item_qty_value=Math.round(field.value);
      									element.templateFieldList[itemcount].value=item_qty_value.toString();
      									}
      									itemcount++;
      							});

      						// }

      						if($scope.reportCorrigendumFinalData[key].hasOwnProperty(element.templategroupId)==false){
      							$scope.reportCorrigendumFinalData[key][[element.templategroupId]] = [];

      							if(element.displayLayoutid == '102'){
      								var tabularHeader = {};
      								angular.forEach(element.templateFieldList, function(field){
      									if(field.isVisible == 'Y' && field.roleWiseFieldEntry != 'H'){
      										tabularHeader[field.shortName] = field.longName;
      									}
      								});
      								$scope.reportCorrigendumFinalData[key][element.templategroupId].push(tabularHeader);
      							}
      						}
      						$scope.reportCorrigendumFinalData[key][element.templategroupId].push(element);


      					});
      				}
      			}


      	// sorting object report corrigendam final data

      			$scope.orderedReportCorrigendumFinalData = {};
      			Object.keys($scope.reportCorrigendumFinalData).sort().forEach(function(key) {
      				$scope.orderedReportCorrigendumFinalData[key] = $scope.reportCorrigendumFinalData[key];
      			});

      			// prepare new format reportCorrigendumFinalData change view
      			$scope.viewData={};
      			for(var data in $scope.reportCorrigendumFinalData){
      				for(var key in $scope.reportCorrigendumFinalData[data]){
      					$scope.viewData[key+"_"+data]=$scope.reportCorrigendumFinalData[data][key];
      				}
      			}

      			$scope.finalData = {};
      			Object.keys($scope.viewData).sort().forEach(function(key) {
      				$scope.finalData[key] = $scope.viewData[key];
      			});

      			$scope.genInfoView={};
      			angular.forEach($scope.finalData, function(value, key){
      				$scope.vendorNameList = "";

      				angular.forEach(value.tenderVendors, function(vendor) {
      					if($scope.vendorNameList.length == 0){
      						$scope.vendorNameList = vendor.vendorOrg;
      					}else{
      						$scope.vendorNameList = $scope.vendorNameList +" , "+ vendor.vendorOrg;
      					}

      				});
      				value.vendorNameList = angular.copy($scope.vendorNameList);

      				if(key=="genInfo_new"){
      					$scope.genInfoView["new"]=value;
      					delete $scope.finalData[key];
      				}
      				if(key=="genInfo_old"){
      					$scope.genInfoView["old"]=value;
      					delete $scope.finalData[key];
      				}
      			});

      			$scope.finalCorrihendumHistoryData = _.values($scope.finalData);

      			for(var i=0 ; i < $scope.finalCorrihendumHistoryData.length; i++){
      				for(var j=i+1 ; j < $scope.finalCorrihendumHistoryData.length; j++){
      					var sequence1, sequence2;
      					if($scope.finalCorrihendumHistoryData[i].length == 1){
      						sequence1 = $scope.finalCorrihendumHistoryData[i][0].displaySequenceNo;
      					}else{
      						sequence1 = $scope.finalCorrihendumHistoryData[i][1].displaySequenceNo;
      					}
      					if($scope.finalCorrihendumHistoryData[j].length == 1){
      						sequence2 = $scope.finalCorrihendumHistoryData[j][0].displaySequenceNo;
      					}else{
      						sequence2 = $scope.finalCorrihendumHistoryData[j][1].displaySequenceNo;
      					}

      					if(sequence1 > sequence2){
      						var temp = $scope.finalCorrihendumHistoryData[i];
      						$scope.finalCorrihendumHistoryData[i] = $scope.finalCorrihendumHistoryData[j];
      						$scope.finalCorrihendumHistoryData[j] = temp;
      					}
      				}
      			}

      			for(var i = 0; i< $scope.finalCorrihendumHistoryData.length; i++){
      				if($scope.finalCorrihendumHistoryData[i].length > 1){
      					var isRfqItems = $scope.finalCorrihendumHistoryData[i][1].templateTypeId;
      					if(isRfqItems == 103){
      						var tempItem = [];
      						tempItem.push($scope.finalCorrihendumHistoryData[i][0]);
      						$scope.finalCorrihendumHistoryData[i].shift();
      						$scope.finalCorrihendumHistoryData[i] = tempItem.concat(utilityService.sortRfqItems($scope.finalCorrihendumHistoryData[i]));
      					}
      				}
      			}

      			$("#loading").hide();
                $("#corrigendumReport").modal('show');
      		}, function(err) {
      			$("#loading").hide();
      			utilityService.handelError(err.headers('errorMsg'),err.status);
      		});
      	}

}]);
