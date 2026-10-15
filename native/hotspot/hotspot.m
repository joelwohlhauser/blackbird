#import <CoreLocation/CoreLocation.h>
#import <CoreWLAN/CoreWLAN.h>
#import <Foundation/Foundation.h>
#import <dlfcn.h>
#import <objc/runtime.h>

@interface SFRemoteHotspotSession : NSObject
- (void)setDelegate:(id)delegate;
- (void)startBrowsing;
- (void)stopBrowsing;
- (void)enableRemoteHotspotForDevice:(id)device withCompletionHandler:(void (^)(id info))handler;
@end

@interface HotspotDelegate : NSObject
@property(strong) SFRemoteHotspotSession *session;
@property BOOL requested;
@property(strong) id info;
@property BOOL finished;
@end

@implementation HotspotDelegate
- (void)session:(id)session updatedFoundDevices:(NSArray *)devices {
  if (self.requested || devices.count == 0) return;
  self.requested = YES;
  [self.session enableRemoteHotspotForDevice:devices.firstObject
                       withCompletionHandler:^(id info) {
                         self.info = info;
                         self.finished = YES;
                       }];
}
@end

static int fail(NSString *message) {
  fprintf(stderr, "%s\n", message.UTF8String);
  return 1;
}

static int printJSON(id value) {
  NSData *json = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  fwrite(json.bytes, 1, json.length, stdout);
  fputc('\n', stdout);
  return 0;
}

static BOOL locationAuthorized(NSTimeInterval wait) {
  CLLocationManager *location = [CLLocationManager new];
  if (location.authorizationStatus == kCLAuthorizationStatusNotDetermined) {
    [location requestWhenInUseAuthorization];
  }
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:wait];
  while (location.authorizationStatus == kCLAuthorizationStatusNotDetermined &&
         deadline.timeIntervalSinceNow > 0) {
    [[NSRunLoop mainRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.25]];
  }
  return location.authorizationStatus == kCLAuthorizationStatusAuthorizedAlways;
}

static int scan(void) {
  BOOL authorized = locationAuthorized(3);
  NSError *error = nil;
  NSSet<CWNetwork *> *networks =
      [[CWWiFiClient sharedWiFiClient].interface scanForNetworksWithName:nil error:&error];
  if (!networks) return fail(error.localizedDescription ?: @"The Wi-Fi scan failed.");
  NSMutableOrderedSet<NSString *> *names = [NSMutableOrderedSet orderedSet];
  for (CWNetwork *network in networks) {
    if (network.ssid.length > 0) [names addObject:network.ssid];
  }
  return printJSON(@{@"authorized" : @(authorized), @"names" : names.array});
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSString *mode = argc > 1 ? @(argv[1]) : @"wake";
    if ([mode isEqualToString:@"scan"]) return scan();
    if ([mode isEqualToString:@"authorize"]) return printJSON(@{@"authorized" : @(locationAuthorized(120))});
    if (!dlopen("/System/Library/PrivateFrameworks/Sharing.framework/Sharing", RTLD_NOW)) {
      return fail(@"Sharing.framework is unavailable.");
    }
    Class sessionClass = objc_getClass("SFRemoteHotspotSession");
    if (!sessionClass) return fail(@"This macOS has no Instant Hotspot session.");

    HotspotDelegate *delegate = [HotspotDelegate new];
    delegate.session = [[sessionClass alloc] init];
    [delegate.session setDelegate:delegate];
    [delegate.session startBrowsing];
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:45];
    while (!delegate.finished && [deadline timeIntervalSinceNow] > 0) {
      [[NSRunLoop mainRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.25]];
    }
    [delegate.session stopBrowsing];

    if (!delegate.requested) return fail(@"No iPhone with Personal Hotspot was found nearby.");
    if (!delegate.finished) return fail(@"The iPhone didn't turn on its hotspot in time.");
    id info = delegate.info;
    NSString *name = [info respondsToSelector:@selector(name)] ? [info valueForKey:@"name"] : nil;
    NSString *password =
        [info respondsToSelector:@selector(password)] ? [info valueForKey:@"password"] : nil;
    if (![name isKindOfClass:NSString.class] || name.length == 0) {
      return fail(@"The iPhone didn't share its hotspot details.");
    }
    return printJSON(@{
      @"name" : name,
      @"password" : [password isKindOfClass:NSString.class] ? password : @"",
    });
  }
}
