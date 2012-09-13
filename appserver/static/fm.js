fm = function() {
    var fm = this;
    Async = splunkjs.Async;
    utils = splunkjs.Utils;
    UI = splunkjs.UI;
    var http = new splunkjs.SplunkWebHttp();
    fm.service = new splunkjs.Service(http, {
        "version": 5.0
    });
}

/*
** Search Splunk.  Takes full splunk search string and calls a callback with (err, results)
*/
fm.prototype.rtsearch = function(searchstr, callback, donecallback) {
    var fm = this;
    var donecallback = donecallback || function () { };
    var MAX_COUNT = 10 * 60; // 10 Minutes
    Async.chain([
            // First, we log in
            function(done) {
                fm.service.login(done);
            },
            // Perform the search
            function(success, done) {
                if (!success) {
                    done("Error logging in");
                }
            
                fm.service.search(
                    searchstr, 
                    {earliest_time: "rt-1m", latest_time: "rt", auto_cancel: MAX_COUNT, max_time: MAX_COUNT}, 
                    done);
            },
            // The search is never going to be done, so we simply poll it every second to get
            // more results
            function(job, done) {
                var count = 0;
                
                // Since search will never be done, register an unload event which will close the search
                // if the window is closed
                $(window).unload(function() {
                    job.cancel(done);
                });
                
                Async.whilst(
                    // Loop for N times
                    function() { return MAX_COUNT > count; },
                    //function() { true; },
                    // Every second, ask for preview results
                    function(iterationDone) {
                        Async.sleep(1000, function() {
                            job.preview({}, function(err, results) {
                                if (err) {
                                    iterationDone(err);
                                }

                                // Up the iteration counter
                                count++;
                            
                                // Only do something if we have results
                                if (results.rows) {                                    
                                
                                    // console.log("========== Iteration " + count + " ==========");
                                    // var sourcetypeIndex = utils.indexOf(results.fields, "sourcetype");
                                    // var countIndex      = utils.indexOf(results.fields, "count");
                                    //                                 
                                    // for(var i = 0; i < results.rows.length; i++) {
                                    //     var row = results.rows[i];
                                    // 
                                    //     // This is a hacky "padding" solution
                                    //     var stat = ("  " + row[sourcetypeIndex] + "                         ").slice(0, 30);
                                    // 
                                    //     // Print out the sourcetype and the count of the sourcetype so far
                                    //     console.log(stat + row[countIndex]);   
                                    // }
                                    //                                 
                                    // console.log("=================================");
                                    
                                    // Splunkbot inserted to call callback here when we have results
                                    if (results.rows.length > 0) {
                                        callback(undefined, results);
                                    }
                                }
                                
                                // And we're done with this iteration
                                iterationDone();
                            });
                        });
                    },
                    // When we're done looping, just cancel the job
                    function(err) {
                        job.cancel(done);
                        donecallback();
                    }
                );
            }
        ],
        function(err) {
            callback(err);        
        }
    );
}

fm.prototype.search = function(searchstr, callback) {
    var fm = this;
    
    Async.chain([
            // First, we log in
            function(done) {
                fm.service.login(done);
            },
            // Perform the search
            function(success, done) {
                if (!success) {
                    done("Error logging in");
                }

                fm.service.search(searchstr, { max_results: 10000 }, done);
            },
            // Wait until the job is done
            function(job, done) {
                Async.whilst(
                    // Loop until it is done
                    function() { return !job.properties().isDone; },
                    // Refresh the job on every iteration, but sleep for 1 second
                    function(iterationDone) {
                        Async.sleep(1000, function() {
                            // Refresh the job and note how many events we've looked at so far
                            job.fetch(function(err) {
                                console.log("-- fetching, " + (job.properties().eventCount || 0) + " events so far");
                                iterationDone();
                            });
                        });
                    },
                    // When we're done, just pass the job forward
                    function(err) {
                        console.log("-- job done --");
                        done(err, job);
                    }
                );
            },
            // Print out the statistics and get the results
            function(job, done) {
                // Print out the statics
                console.log("Job Statistics: ");
                console.log("  Event Count: " + job.properties().eventCount);
                console.log("  Disk Usage: " + job.properties().diskUsage + " bytes");
                console.log("  Priority: " + job.properties().priority);

                // Ask the server for the results
                job.results({ count: 10000 }, done);
            },
            // Print the raw results out
            function(results, job, done) {
                // Find the index of the fields we want
                var rawIndex        = utils.indexOf(results.fields, "_raw");
                var sourcetypeIndex = utils.indexOf(results.fields, "sourcetype");
                var userIndex       = utils.indexOf(results.fields, "user");

                // Print out each result and the key-value pairs we want
                console.log("Results: ");
                for(var i = 0; i < results.rows.length; i++) {
                    console.log("  Result " + i + ": ");
                    console.log("    sourcetype: " + results.rows[i][sourcetypeIndex]);
                    console.log("    user: " + results.rows[i][userIndex]);
                    console.log("    _raw: " + results.rows[i][rawIndex]);
                }
                
                callback(undefined, results);

                // Once we're done, cancel the job.
                job.cancel(done);
            }
        ],
        function(err) {
            if (err) {
                callback(err); 
            }       
        }
    );
}

fm.prototype.map = function() {
    // searchstring = "| inputlookup test"
    var searchstring = '| inputlookup forwarders.csv | join hostname type=left [search index=_internal tcp source="/opt/splunk/var/log/splunk/metrics.log" group=tcpin_connections earliest=-35s | dedup hostname] | table hostname,splunk_server,tcp_KBps | join [search index=_internal queue "name=tcpin_queue" source="/opt/splunk/var/log/splunk/metrics.log" | eval blockedQueue=if(current_size_kb<max_size_kb,"false","true") | table blockedQueue] | table  hostname,splunk_server,tcp_KBps,blockedQueue | rename hostname AS Forwarder, splunk_server AS Indexer,  tcp_KBps AS Weight | eval Weight=(Weight/256)*500 | eval Weight=if(isnull(Weight),"-1",Weight)';
    fm.search(searchstring, function(err, results) {
        var rows = results.rows;
        var fields = results.fields;
        // var types = [ 'circle', 'star', 'triangle' ];
        // var colors = [ "#800000", // dark red
        //                "#FF0000", // red
        //                "#FF00FF", // pink
        //                "#008000", // teal
        //                "#00FFFF", // cyan
        //                "#008000", // green
        //                "#00FF00", // bright green
        //                "#000080", // green
        //                "#0000FF", // blue
        //                "#800080", // violet
        //                "#808000", // dark yellow
        //                "#FFFF00" ] // yellow

        // console.log(JSON.stringify(results, null, 2));
        
        var json = [ ];
        var currentIndexer = "";
        var adjacenciesIdx = 0;
        var indexerIdx = 0;
        var color = "";
        var type = ""
        for (var i = 0; i < rows.length; i++) {
                
            // We've encountered a new nick, start a new JSON object
            if (currentIndexer != rows[i][fields.indexOf('Indexer')]) {
                if (i !== 0) {
                    indexerIdx++;
                }
                // console.log(util.format("%d currentIndexer: %s newNick: %s", i, currentIndexer, rows[i][fields.indexOf('nick')]));
                currentIndexer = rows[i][fields.indexOf('Indexer')];
                green = "#00FF00";
                red = "#FF0000";
                // color = colors[indexerIdx % 12];
                // type = types[indexerIdx % 3];
                adjacenciesIdx = 0;
                json[indexerIdx] = { };
                json[indexerIdx].id = currentIndexer;
                json[indexerIdx].name = currentIndexer;
                json[indexerIdx].data = { };
                json[indexerIdx].data['$color'] = green;
                json[indexerIdx].data['$type'] = "circle";
                json[indexerIdx].data['$dim'] = 12;
                json[indexerIdx].adjacencies = [ ];
            }
            // console.log(util.format("adjacenciesIdx %s", adjacenciesIdx));
            json[indexerIdx].adjacencies[adjacenciesIdx] = { }
            json[indexerIdx].adjacencies[adjacenciesIdx].nodeFrom = currentIndexer;
            json[indexerIdx].adjacencies[adjacenciesIdx].nodeTo = rows[i][fields.indexOf('Forwarder')];
            json[indexerIdx].adjacencies[adjacenciesIdx].data = { };
            if (parseFloat(rows[i][fields.indexOf('Weight')]) > 0) {
                json[indexerIdx].adjacencies[adjacenciesIdx].data['$color'] = green;
                json[indexerIdx].adjacencies[adjacenciesIdx].data['$lineWidth'] = rows[i][fields.indexOf('Weight')];
            } else{
                json[indexerIdx].data['$color'] = red;
                json[indexerIdx].adjacencies[adjacenciesIdx].data['$color'] = red;
                json[indexerIdx].adjacencies[adjacenciesIdx].data['$lineWidth'] = 1.0;
            }
            adjacenciesIdx++;
        }

        var labelType, useGradients, nativeTextSupport, animate;
        
        var ua = navigator.userAgent,
            iStuff = ua.match(/iPhone/i) || ua.match(/iPad/i),
            typeOfCanvas = typeof HTMLCanvasElement,
            nativeCanvasSupport = (typeOfCanvas == 'object' || typeOfCanvas == 'function'),
            textSupport = nativeCanvasSupport 
              && (typeof document.createElement('canvas').getContext('2d').fillText == 'function');
        //I'm setting this based on the fact that ExCanvas provides text support for IE
        //and that as of today iPhone/iPad current text support is lame
        labelType = (!nativeCanvasSupport || (textSupport && !iStuff))? 'Native' : 'HTML';
        nativeTextSupport = labelType == 'Native';
        useGradients = nativeCanvasSupport;
        animate = !(iStuff || !nativeCanvasSupport);
        
        var Log = {
          elem: false,
          write: function(text){
            if (!this.elem) 
              this.elem = document.getElementById('log');
            this.elem.innerHTML = text;
            this.elem.style.left = (500 - this.elem.offsetWidth / 2) + 'px';
          }
        };
        
        
        // Copy and pasted from http://thejit.org/static/v20/Jit/Examples/ForceDirected/example1.code.html
        var fd = new $jit.ForceDirected({  
          //id of the visualization container  
          injectInto: 'canvas',  
          //Enable zooming and panning  
          //by scrolling and DnD  
          Navigation: {  
            enable: true,  
            //Enable panning events only if we're dragging the empty  
            //canvas (and not a node).  
            panning: 'avoid nodes',  
            zooming: 10 //zoom speed. higher is more sensible  
          },  
          // Change node and edge styles such as  
          // color and width.  
          // These properties are also set per node  
          // with dollar prefixed data-properties in the  
          // JSON structure.  
          Node: {  
            overridable: true  
          },  
          Edge: {  
            overridable: true,  
            color: '#23A4FF',  
            lineWidth: 0.4  
          },  
          //Native canvas text styling  
          Label: {  
            type: labelType, //Native or HTML  
            size: 18,  
            style: 'bold'  
          },  
          //Add Tips  
          Tips: {  
            enable: true,  
            onShow: function(tip, node) {  
              //count connections  
              var count = 0;  
              node.eachAdjacency(function() { count++; });  
              //display node info in tooltip  
              tip.innerHTML = "<div class=\"tip-title\">" + node.name + "</div>"  
                + "<div class=\"tip-text\"><b>connections:</b> " + count + "</div>";  
            }  
          },  
          // Add node events  
          Events: {  
            enable: true,  
            type: 'Native',  
            //Change cursor style when hovering a node  
            onMouseEnter: function() {  
              fd.canvas.getElement().style.cursor = 'move';  
            },  
            onMouseLeave: function() {  
              fd.canvas.getElement().style.cursor = '';  
            },  
            //Update node positions when dragged  
            onDragMove: function(node, eventInfo, e) {  
                var pos = eventInfo.getPos();  
                node.pos.setc(pos.x, pos.y);  
                fd.plot();  
            },  
            //Implement the same handler for touchscreens  
            onTouchMove: function(node, eventInfo, e) {  
              $jit.util.event.stop(e); //stop default touchmove event  
              this.onDragMove(node, eventInfo, e);  
            },  
            //Add also a click handler to nodes  
            onClick: function(node) {  
              if(!node) return;  
              // Build the right column relations list.  
              // This is done by traversing the clicked node connections.  
              var html = "<h4>" + node.name + "</h4><b> connections:</b><ul><li>",  
                  list = [];  
              node.eachAdjacency(function(adj){  
                list.push(adj.nodeTo.name);  
              });  
              //append connections information  
              $jit.id('inner-details').innerHTML = html + list.join("</li><li>") + "</li></ul>";  
            }  
          },  
          //Number of iterations for the FD algorithm  
          iterations: 200,  
          //Edge length  
          levelDistance: 130,  
          // Add text to the labels. This method is only triggered  
          // on label creation and only for DOM labels (not native canvas ones).  
          onCreateLabel: function(domElement, node){  
            domElement.innerHTML = node.name;  
            var style = domElement.style;  
            style.fontSize = "0.8em";  
            style.color = "#ddd";  
          },  
          // Change node styles when DOM labels are placed  
          // or moved.  
          onPlaceLabel: function(domElement, node){  
            var style = domElement.style;  
            var left = parseInt(style.left);  
            var top = parseInt(style.top);  
            var w = domElement.offsetWidth;  
            style.left = (left - w / 2) + 'px';  
            style.top = (top + 10) + 'px';  
            style.display = '';  
          }  
        });  
        // load JSON data.  
        fd.loadJSON(json);  
        // compute positions incrementally and animate.  
        fd.computeIncremental({  
          iter: 40,  
          property: 'end',  
          onStep: function(perc){  
            Log.write(perc + '% loaded...');  
          },  
          onComplete: function(){  
            Log.write('done');  
            fd.animate({  
              modes: ['linear'],  
              transition: $jit.Trans.Elastic.easeOut,  
              duration: 2500  
            });  
          }  
        });


    });
}

fm.prototype.sidebar = function () {
    var searchstring = 'search index="_internal" source="*metrics.log" group="per_index_thruput" earliest=-0d@d | stats sum(kb) as kb | eval kb=kb/1000 | eval kb=round(kb,2) | rename kb AS "Licence Usage Today"';
    fm.search(searchstring, function(err, results) {
        var license_today = results.rows[0][0];
        $("#server-usage").text(license_today);
    });

    var searchstring = '| rest /services/licenser/licenses | table max_violations, label,status,expiration_time  | search label!="Splunk Forwarder" status!="EXPIRED" | sort - max_violations | head 1 | table max_violations | join [search index=_internal source=*license_audit.log violation earliest=-30d | stats count] | eval "Remaining Violations"=max_violations-count | table "Remaining Violations"';
    fm.search(searchstring, function(err, results) {
        var remaining_violations = results.rows[0][0];
        $("#server-violations").text(remaining_violations);
    });

    var searchstring = '| rest /services/licenser/licenses | table max_violations, label,status,expiration_time  | search label!="Splunk Forwarder" status!="EXPIRED" | sort - max_violations | head 1 | table max_violations | rename max_violations AS "Maximum Violations"';
    fm.search(searchstring, function(err, results) {
        var max_violations = results.rows[0][0];
        $("#server-max-violations").text(max_violations);
    });
}

$(document).ready(function() {
    fm = new fm();
    
    // Decode query string, copy and pasted code from somewhere
    // urlParams = {};
    // var e,
    //     a = /\+/g,  // Regex for replacing addition symbol with a space
    //     r = /([^&=]+)=?([^&]*)/g,
    //     d = function (s) { return decodeURIComponent(s.replace(a, " ")); },
    //     q = window.location.search.substring(1);

    // while (e = r.exec(q))
    //    urlParams[d(e[1])] = d(e[2]);

    fm.map();
    setInterval(function () { fm.map();  }, 10000);
    fm.sidebar();
    setInterval(function() { fm.sidebar() }, 10000);
});