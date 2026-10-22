'use strict';
Component({
  data:{chartImage:'',chartFailed:false},
  properties:{points:{type:Array,value:[]},height:{type:Number,value:116},compact:{type:Boolean,value:true},emptyTitle:{type:String,value:'暂无可展示折线'},emptyHint:{type:String,value:'进入档案查看或记录成绩'}},
  observers:{'points,height':function(){this._schedule();}},
  lifetimes:{ready(){this._ready=true;this._schedule();},detached(){this._ready=false;}},
  pageLifetimes:{show(){this._schedule();},resize(){this._schedule();}},
  methods:{
    _schedule(){if(!this._ready)return;wx.nextTick(()=>{if(this._ready)this._draw();});},
    _draw(){
      const paintId=this._paintId=(this._paintId||0)+1;
      this.setData({chartImage:'',chartFailed:false});
      const points=(this.data.points||[]).filter(p=>typeof p.rate==='number'&&Number.isFinite(p.rate)&&p.rate>=0&&p.rate<=100&&/^\d{4}-\d{2}-\d{2}$/.test(p.date));
      if(!points.length)return;
      this.createSelectorQuery().select('#line').fields({node:true,size:true}).exec(result=>{
        if(!this._ready||paintId!==this._paintId||!result||!result[0]||!result[0].node)return;
        const {node,width,height}=result[0];if(!width||!height)return;
        const ctx=node.getContext('2d');
        const device=typeof wx.getWindowInfo==='function'?wx.getWindowInfo():wx.getSystemInfoSync();
        const dpr=device.pixelRatio||1;
        node.width=Math.round(width*dpr);node.height=Math.round(height*dpr);ctx.scale(dpr,dpr);
        ctx.clearRect(0,0,width,height);
        const left=32,right=14,top=18,bottom=23,w=width-left-right,h=height-top-bottom;
        ctx.font='12px sans-serif';ctx.textBaseline='middle';
        [0,50,100].forEach(value=>{const y=top+(1-value/100)*h;ctx.strokeStyle='#E9ECF1';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(width-right,y);ctx.stroke();ctx.fillStyle='#737C89';ctx.textAlign='right';ctx.fillText(String(value),left-6,y);});
        const times=points.map(p=>Date.parse(p.date+'T00:00:00Z')),min=Math.min.apply(null,times),max=Math.max.apply(null,times);
        const coords=points.map((p,i)=>({x:max===min?left+w/2:left+(times[i]-min)/(max-min)*w,y:top+(1-p.rate/100)*h,p}));
        if(coords.length>1){ctx.strokeStyle='#E4774D';ctx.lineWidth=2;ctx.lineJoin='round';ctx.beginPath();coords.forEach((p,i)=>{if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);});ctx.stroke();}
        coords.forEach((p,i)=>{ctx.beginPath();ctx.arc(p.x,p.y,i===coords.length-1?3.6:2.8,0,Math.PI*2);ctx.fillStyle='#FFFFFF';ctx.fill();ctx.strokeStyle='#E4774D';ctx.lineWidth=1.6;ctx.stroke();});
        const last=coords[coords.length-1];ctx.font='600 12px sans-serif';ctx.fillStyle='#E4774D';ctx.textAlign=last.x>width-55?'right':'center';ctx.fillText(last.p.rate+'%',last.x,Math.max(8,last.y-12));
        ctx.font='12px sans-serif';ctx.fillStyle='#737C89';ctx.textBaseline='alphabetic';
        if(min===max){ctx.textAlign='center';ctx.fillText(points[0].date.slice(5).replace('-','/'),left+w/2,height-4);}
        else{ctx.textAlign='left';ctx.fillText(points[0].date.slice(5).replace('-','/'),left,height-4);ctx.textAlign='right';ctx.fillText(points[points.length-1].date.slice(5).replace('-','/'),width-right,height-4);}
        // Present the local raster as a regular image so scrolling charts obey
        // normal clipping and cannot cover the bottom navigation/safe area.
        const exportFrame=()=>{
          if(!this._ready||paintId!==this._paintId)return;
          wx.canvasToTempFilePath({canvas:node,destWidth:node.width,destHeight:node.height,fileType:'png',
            success:res=>{if(this._ready&&paintId===this._paintId)this.setData({chartImage:res.tempFilePath,chartFailed:false});},
            fail:()=>{if(this._ready&&paintId===this._paintId)this.setData({chartImage:'',chartFailed:true});}
          },this);
        };
        if(typeof node.requestAnimationFrame==='function')node.requestAnimationFrame(exportFrame);else wx.nextTick(exportFrame);
      });
    }
  }
});
