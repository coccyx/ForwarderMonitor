if (Splunk.Module.IFrameInclude) {
       Splunk.Module.IFrameInclude = $.klass(Splunk.Module.IFrameInclude, {
           onLoad: function(event) {
               this.logger.info("IFrameInclude onLoad event fired.");

               this.resize();
               this.iframe.contents().find("body").click(this.resize.bind(this));
           },
  
           resize: function() {
              this.logger.info("IFrameInclude resize fired.");
              
              var height = this.getHeight();
              if(height<1){
                  this.iframe[0].style.height = "auto";
                  this.iframe[0].scrolling = "auto";
              }else{
                  this.iframe[0].style.height = height + this.IFRAME_HEIGHT_FIX + 20 + "px";
                  this.iframe[0].scrolling = "yes";
              }
      
           }

       });
   }
