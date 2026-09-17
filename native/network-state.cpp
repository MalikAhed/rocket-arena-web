// Additive, online-only application ABI. The original bridge and pinned engine
// are compiled unchanged. This captures exposed Soccar gameplay state; it is
// NOT a serialization of Bullet contact manifolds/solver warm-start caches.
#include "bridge.cpp"
namespace {
constexpr int NET_VERSION=1, NET_HEADER=24, NET_CAR=80, NET_PAD=4;
constexpr int NET_MAX=NET_HEADER+MAX_CARS*NET_CAR+40*NET_PAD;
float netState[NET_MAX]{};
int netLength(){return NET_HEADER+static_cast<int>(cars.size())*NET_CAR+static_cast<int>(pads.size())*NET_PAD;}
void writeTick(float* p,uint64_t n){for(int i=0;i<4;i++)p[i]=static_cast<float>((n>>(i*16))&65535ULL);}
bool integer(float v,float max){return std::isfinite(v)&&v>=0&&v<=max&&std::floor(v)==v;}
bool tickValid(const float* p){for(int i=0;i<4;i++)if(!integer(p[i],65535))return false;return true;}
uint64_t readTick(const float* p){uint64_t n=0;for(int i=0;i<4;i++)n|=static_cast<uint64_t>(p[i])<<(i*16);return n;}
int carSlot(uint32_t id){for(size_t i=0;i<cars.size();i++)if(cars[i]->id==id)return static_cast<int>(i)+1;return 0;}
void writeControls(float* p,const CarControls& c){p[0]=c.throttle;p[1]=c.steer;p[2]=c.pitch;p[3]=c.yaw;p[4]=c.roll;p[5]=c.jump;p[6]=c.boost;p[7]=c.handbrake;}
CarControls readControls(const float* p){CarControls c;c.throttle=p[0];c.steer=p[1];c.pitch=p[2];c.yaw=p[3];c.roll=p[4];c.jump=p[5]!=0;c.boost=p[6]!=0;c.handbrake=p[7]!=0;return c;}
bool controlsValid(const float* p){for(int i=0;i<8;i++)if(i<5?(p[i]<-1||p[i]>1):!integer(p[i],1))return false;return true;}
}
extern "C" {
EMSCRIPTEN_KEEPALIVE int physics_netStateVersion(){return NET_VERSION;}
EMSCRIPTEN_KEEPALIVE int physics_getNetStateSize(){return arena?netLength():0;}
EMSCRIPTEN_KEEPALIVE float* physics_captureNetState(){
  if(!arena||unlimited||goalExplosionEnabled)return nullptr;
  std::fill(std::begin(netState),std::end(netState),0);
  float* h=netState;h[0]=202617;h[1]=NET_VERSION;h[2]=cars.size();h[3]=pads.size();writeTick(h+4,arena->tickCount);
  h[8]=goal;h[9]=goalLatched;h[10]=ballGround;h[11]=previousBallContact;h[12]=worldSerial;h[13]=worldSpeed;h[14]=worldSurface;
  h[15]=arena->ball->_groundStickApplied;writeTick(h+16,arena->ball->GetState().tickCountSinceUpdate);writeVec(h+20,arena->ball->_velocityImpulseCache);
  for(size_t i=0;i<cars.size();i++){
    const auto s=cars[i]->GetState();const auto& e=events[i];float* p=h+NET_HEADER+i*NET_CAR;
    writeTick(p,s.tickCountSinceUpdate);p[4]=s.hasJumped;p[5]=s.hasDoubleJumped;p[6]=s.hasFlipped;p[7]=s.isJumping;
    p[8]=s.jumpTime;p[9]=s.flipTime;p[10]=s.isFlipping;p[11]=s.airTime;p[12]=s.airTimeSinceJump;writeVec(p+13,s.flipRelTorque);
    p[16]=s.timeSinceBoosted;p[17]=s.boostingTime;p[18]=s.supersonicTime;p[19]=s.handbrakeVal;
    p[20]=s.isAutoFlipping;p[21]=s.autoFlipTimer;p[22]=s.autoFlipTorqueScale;p[23]=s.worldContact.hasContact;
    writeVec(p+24,s.worldContact.contactNormal);p[27]=carSlot(s.carContact.otherCarID);p[28]=s.carContact.cooldownTimer;p[29]=s.demoRespawnTimer;
    unsigned mask=0;for(int w=0;w<4;w++)if(s.wheelsWithContact[w])mask|=1<<w;p[30]=mask;writeControls(p+31,s.lastControls);
    const auto& hit=s.ballHitInfo;p[39]=hit.isValid;
    if(hit.isValid){writeVec(p+40,hit.relativePosOnBall);writeVec(p+43,hit.ballPos);writeVec(p+46,hit.extraHitVel);writeTick(p+49,hit.tickCountWhenHit);writeTick(p+53,hit.tickCountWhenExtraImpulseApplied);}
    writeVec(p+57,cars[i]->_velocityImpulseCache);p[60]=e.reset;p[61]=e.jump;p[62]=e.dodge;p[63]=e.doubleJump;p[64]=e.wheel;p[65]=e.hit;p[66]=e.wheelSpeed;p[67]=e.hitSpeed;
    for(int w=0;w<4;w++){const auto& wheel=cars[i]->_bulletVehicle.getWheelInfo(w);p[68+3*w]=wheel.m_raycastInfo.m_suspensionLength;p[69+3*w]=wheel.m_steerAngle;p[70+3*w]=wheel.m_raycastInfo.m_isInContact;}
  }
  float* p=h+NET_HEADER+cars.size()*NET_CAR;
  for(size_t i=0;i<pads.size();i++,p+=NET_PAD){const auto s=pads[i]->GetState();p[0]=s.isActive;p[1]=s.cooldown;p[2]=carSlot(s.prevLockedCarID);p[3]=s.curLockedCar?carSlot(s.curLockedCar->id):0;}
  return netState;
}
EMSCRIPTEN_KEEPALIVE int physics_restoreNetState(const float* poses,const float* checkpoint,int length,const int* localToServer){
  if(!arena||unlimited||goalExplosionEnabled||length!=netLength()||!poses||!checkpoint||!localToServer)return 0;
  const int count=static_cast<int>(cars.size());const float* h=checkpoint;
  if(!finite(poses,510)||!finite(h,length)||h[0]!=202617||h[1]!=NET_VERSION||h[2]!=count||h[3]!=pads.size()||poses[2]!=count||poses[3]!=pads.size())return 0;
  if(!tickValid(h+4)||!tickValid(h+16)||!integer(h[8],2)||!integer(h[12],16777215)||!integer(h[14],2)||h[13]<0||h[23]!=0)return 0;
  for(int i:{9,10,11,15})if(!integer(h[i],1))return 0;
  std::array<int,MAX_CARS> inverse{};std::array<bool,MAX_CARS> seen{};
  for(int i=0;i<count;i++){const int server=localToServer[i];if(server<0||server>=count||seen[server])return 0;seen[server]=true;inverse[server]=i;}
  std::array<CarState,MAX_CARS> restored{};std::array<Events,MAX_CARS> eventState{};
  BallState ball{};if(!readPose(ball,poses+4))return 0;ball.tickCountSinceUpdate=readTick(h+16);
  // Parse and validate EVERY record before changing a single native object.
  for(int local=0;local<count;local++){
    const int server=localToServer[local];const float* p=h+NET_HEADER+server*NET_CAR;const float* pose=poses+22+server*STRIDE;auto& s=restored[local];
    if(!readPose(s,pose)||!tickValid(p)||!tickValid(p+49)||!tickValid(p+53)||!controlsValid(p+31)||!integer(p[27],count)||!integer(p[30],15))return 0;
    for(int i:{4,5,6,7,10,20,23,39})if(!integer(p[i],1))return 0;
    for(int i:{8,9,11,12,16,17,18,19,28,29,66,67})if(p[i]<0)return 0;
    for(int i=60;i<66;i++)if(!integer(p[i],16777215))return 0;
    if(p[21]<-1.f/120.f || p[19]>1)return 0;
    if(pose[18]<0||pose[18]>100)return 0;for(int i:{19,20,21,23})if(!integer(pose[i],1))return 0;
    for(int w=0;w<4;w++)if(!integer(p[70+3*w],1))return 0;
    s.tickCountSinceUpdate=readTick(p);s.boost=pose[18];s.isOnGround=pose[19]!=0;s.isSupersonic=pose[20]!=0;s.isDemoed=pose[21]!=0;s.isBoosting=pose[23]!=0;
    s.hasJumped=p[4]!=0;s.hasDoubleJumped=p[5]!=0;s.hasFlipped=p[6]!=0;s.isJumping=p[7]!=0;s.jumpTime=p[8];s.flipTime=p[9];s.isFlipping=p[10]!=0;s.airTime=p[11];s.airTimeSinceJump=p[12];s.flipRelTorque=readVec(p+13);
    s.timeSinceBoosted=p[16];s.boostingTime=p[17];s.supersonicTime=p[18];s.handbrakeVal=p[19];s.isAutoFlipping=p[20]!=0;s.autoFlipTimer=p[21];s.autoFlipTorqueScale=p[22];
    s.worldContact.hasContact=p[23]!=0;s.worldContact.contactNormal=readVec(p+24);s.carContact.otherCarID=p[27]?cars[inverse[static_cast<int>(p[27])-1]]->id:0;s.carContact.cooldownTimer=p[28];s.demoRespawnTimer=p[29];
    for(int w=0;w<4;w++)s.wheelsWithContact[w]=(static_cast<unsigned>(p[30])&(1<<w))!=0;s.lastControls=readControls(p+31);
    auto& hit=s.ballHitInfo;hit.isValid=p[39]!=0;if(hit.isValid){hit.relativePosOnBall=readVec(p+40);hit.ballPos=readVec(p+43);hit.extraHitVel=readVec(p+46);hit.tickCountWhenHit=readTick(p+49);hit.tickCountWhenExtraImpulseApplied=readTick(p+53);}
    eventState[local]={static_cast<unsigned>(p[60]),static_cast<unsigned>(p[61]),static_cast<unsigned>(p[62]),static_cast<unsigned>(p[63]),static_cast<unsigned>(p[64]),static_cast<unsigned>(p[65]),p[66],p[67]};
  }
  const float* pad=h+NET_HEADER+count*NET_CAR;
  for(size_t i=0;i<pads.size();i++){const float* p=pad+i*NET_PAD;if(!integer(p[0],1)||p[1]<0||p[1]>60||!integer(p[2],count)||!integer(p[3],count))return 0;}
  arena->tickCount=readTick(h+4);arena->ball->SetState(ball);arena->ball->_internalState.tickCountSinceUpdate=ball.tickCountSinceUpdate;
  arena->ball->_groundStickApplied=h[15]!=0;arena->ball->_velocityImpulseCache=readVec(h+20);synchronizeTeleport(arena->ball->_rigidBody);
  for(int local=0;local<count;local++){
    const float* p=h+NET_HEADER+localToServer[local]*NET_CAR;auto car=cars[local];car->SetState(restored[local]);car->_internalState.tickCountSinceUpdate=restored[local].tickCountSinceUpdate;
    car->_velocityImpulseCache=readVec(p+57);car->controls=restored[local].lastControls;writeControls(controls+local*8,car->controls);events[local]=eventState[local];synchronizeTeleport(car->_rigidBody);
    for(int w=0;w<4;w++){auto& wheel=car->_bulletVehicle.getWheelInfo(w);wheel.m_raycastInfo.m_suspensionLength=p[68+3*w];wheel.m_steerAngle=p[69+3*w];wheel.m_raycastInfo.m_isInContact=p[70+3*w]!=0;}
  }
  for(size_t i=0;i<pads.size();i++){const float* p=pad+i*NET_PAD;BoostPadState s{};s.isActive=p[0]!=0;s.cooldown=p[1];s.prevLockedCarID=p[2]?cars[inverse[static_cast<int>(p[2])-1]]->id:0;s.curLockedCar=p[3]?cars[inverse[static_cast<int>(p[3])-1]]:nullptr;pads[i]->SetState(s);}
  goal=static_cast<int>(h[8]);goalLatched=h[9]!=0;ballGround=h[10]!=0;previousBallContact=h[11]!=0;worldSerial=static_cast<unsigned>(h[12]);worldSpeed=h[13];worldSurface=h[14];
  goalBlastApplied=false;goalBlastRemaining=0;publish();return 1;
}
}
