/*
 * A small, self-contained OFX image-effect host.
 *
 * The public ABI (ofx_host.h) is deliberately plain C: the Rust side owns JSON,
 * file IO and CLI plumbing, this file owns the plugin ABI and pixel buffers.
 *
 * Only the parts needed to describe and render an image effect are implemented.
 * There is no interactive UI, no timeline and no OpenGL/OpenCL/Metal path.
 */

#include "ofx_host.h"

#include <stdbool.h>

#include "openfx/ofxCore.h"
#include "openfx/ofxProperty.h"
#include "openfx/ofxImageEffect.h"
#include "openfx/ofxParam.h"
#include "openfx/ofxMemory.h"
#include "openfx/ofxMultiThread.h"
#include "openfx/ofxMessage.h"
#include "openfx/ofxProgress.h"
#include "openfx/ofxTimeLine.h"
#include "openfx/ofxParametricParam.h"

#include <errno.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#ifdef _WIN32
#include <windows.h>
typedef HMODULE OfxLibHandle;
#define OFX_LIB_OPEN(path) LoadLibraryA(path)
#define OFX_LIB_SYM(lib, name) ((void *)GetProcAddress((HMODULE)(lib), (name)))
#define OFX_LIB_CLOSE(lib) FreeLibrary((HMODULE)(lib))
#else
#include <dlfcn.h>
#include <dirent.h>
#include <unistd.h>
typedef void *OfxLibHandle;
#define OFX_LIB_OPEN(path) dlopen((path), RTLD_NOW | RTLD_LOCAL)
#define OFX_LIB_SYM(lib, name) dlsym((lib), (name))
#define OFX_LIB_CLOSE(lib) dlclose(lib)
#endif

#ifndef OFX_HOST_VERSION
#define OFX_HOST_VERSION "0.1.0"
#endif

#ifndef PATH_MAX
#define PATH_MAX 4096
#endif

/* Params and clips are handed to the plugin as stable pointers, so their
 * backing arrays must never move.  Reserve the documented limits up front
 * instead of reallocating as the plugin declares more of them. */
#ifndef OFX_HOST_MAX_PARAMS
#define OFX_HOST_MAX_PARAMS 2048
#endif
#ifndef OFX_HOST_MAX_CLIPS
#define OFX_HOST_MAX_CLIPS 64
#endif

/* ------------------------------------------------------------------------- */
/* Small helpers                                                             */
/* ------------------------------------------------------------------------- */

static char *dup_text(const char *text)
{
  if (!text) {
    return NULL;
  }
  size_t size = strlen(text) + 1;
  char *out = (char *)malloc(size);
  if (out) {
    memcpy(out, text, size);
  }
  return out;
}

static int ends_with(const char *text, const char *suffix)
{
  if (!text || !suffix) {
    return 0;
  }
  size_t text_len = strlen(text);
  size_t suffix_len = strlen(suffix);
  return text_len >= suffix_len &&
         strcmp(text + text_len - suffix_len, suffix) == 0;
}

#ifdef _WIN32
#define OFX_S_IFMT _S_IFMT
#define OFX_S_IFREG _S_IFREG
#define OFX_S_IFDIR _S_IFDIR
#else
#define OFX_S_IFMT S_IFMT
#define OFX_S_IFREG S_IFREG
#define OFX_S_IFDIR S_IFDIR
#endif

static int is_file(const char *path)
{
  struct stat st;
  return path && stat(path, &st) == 0 && (st.st_mode & OFX_S_IFMT) == OFX_S_IFREG;
}

static int is_dir(const char *path)
{
  struct stat st;
  return path && stat(path, &st) == 0 && (st.st_mode & OFX_S_IFMT) == OFX_S_IFDIR;
}

static void set_error(char **error, const char *format, ...)
{
  if (!error || *error) {
    return;
  }
  va_list args;
  va_start(args, format);
  char buffer[2048];
  vsnprintf(buffer, sizeof(buffer), format, args);
  va_end(args);
  *error = dup_text(buffer);
}

static void quiet_message(const char *type, const char *id, const char *format)
{
  const char *verbose = getenv("AICUT_OFX_VERBOSE");
  if (!verbose || strcmp(verbose, "0") == 0) {
    return;
  }
  fprintf(stderr, "[ofx %s %s] %s\n", type ? type : "-", id ? id : "-",
          format ? format : "");
}

const char *ofx_host_version(void)
{
  return OFX_HOST_VERSION;
}

void ofx_host_free(void *pointer)
{
  free(pointer);
}

/* ------------------------------------------------------------------------- */
/* Property sets                                                             */
/* ------------------------------------------------------------------------- */

enum
{
  PROP_NONE = 0,
  PROP_STRING,
  PROP_DOUBLE,
  PROP_INT,
  PROP_POINTER
};

typedef struct
{
  char *key;
  int kind;
  int count;
  void *values; /* char ** | double * | int * | void ** */
} Prop;

typedef struct OfxPropertySetStruct
{
  Prop *items;
  int count;
  int capacity;
} PropSet;

static Prop *find_prop(PropSet *set, const char *key, int create)
{
  if (!set || !key) {
    return NULL;
  }
  for (int i = 0; i < set->count; i++) {
    if (strcmp(set->items[i].key, key) == 0) {
      return &set->items[i];
    }
  }
  if (!create) {
    return NULL;
  }
  if (set->count + 1 > set->capacity) {
    int capacity = set->capacity ? set->capacity * 2 : 16;
    Prop *items = (Prop *)realloc(set->items, (size_t)capacity * sizeof(Prop));
    if (!items) {
      return NULL;
    }
    memset(items + set->capacity, 0,
           (size_t)(capacity - set->capacity) * sizeof(Prop));
    set->items = items;
    set->capacity = capacity;
  }
  Prop *prop = &set->items[set->count++];
  memset(prop, 0, sizeof(*prop));
  prop->key = dup_text(key);
  return prop;
}

static void free_prop_values(Prop *prop)
{
  if (!prop || !prop->values) {
    return;
  }
  if (prop->kind == PROP_STRING) {
    char **values = (char **)prop->values;
    for (int i = 0; i < prop->count; i++) {
      free(values[i]);
    }
  }
  free(prop->values);
  prop->values = NULL;
  prop->count = 0;
  prop->kind = PROP_NONE;
}

static void prop_set_free(PropSet *set)
{
  if (!set) {
    return;
  }
  for (int i = 0; i < set->count; i++) {
    free_prop_values(&set->items[i]);
    free(set->items[i].key);
  }
  free(set->items);
  memset(set, 0, sizeof(*set));
}

static size_t kind_size(int kind)
{
  switch (kind) {
  case PROP_STRING:
  case PROP_POINTER:
    return sizeof(void *);
  case PROP_DOUBLE:
    return sizeof(double);
  case PROP_INT:
    return sizeof(int);
  default:
    return 0;
  }
}

static int ensure_capacity(Prop *prop, int count)
{
  if (!prop || count <= 0) {
    return kOfxStatErrValue;
  }
  if (count <= prop->count && prop->values) {
    return kOfxStatOK;
  }
  size_t item_size = kind_size(prop->kind);
  if (!item_size) {
    return kOfxStatErrValue;
  }
  int capacity = prop->count > 0 ? prop->count : 1;
  while (capacity < count) {
    capacity *= 2;
  }
  void *values = realloc(prop->values, (size_t)capacity * item_size);
  if (!values) {
    return kOfxStatErrMemory;
  }
  memset((char *)values + (size_t)prop->count * item_size, 0,
         (size_t)(capacity - prop->count) * item_size);
  prop->values = values;
  prop->count = count;
  return kOfxStatOK;
}

static int prepare_prop(PropSet *set, const char *key, int kind, int index,
                        Prop **out)
{
  Prop *prop = find_prop(set, key, 1);
  if (!prop) {
    return kOfxStatErrMemory;
  }
  if (prop->kind != PROP_NONE && prop->kind != kind) {
    return kOfxStatErrValue;
  }
  prop->kind = kind;
  if (index < 0) {
    return kOfxStatErrBadIndex;
  }
  int status = ensure_capacity(prop, index + 1);
  if (status != kOfxStatOK) {
    return status;
  }
  *out = prop;
  return kOfxStatOK;
}

static OfxStatus ps_set_string(OfxPropertySetHandle handle, const char *key,
                               int index, const char *value)
{
  if (!handle) {
    return kOfxStatErrBadHandle;
  }
  Prop *prop = NULL;
  int status = prepare_prop((PropSet *)handle, key, PROP_STRING, index, &prop);
  if (status != kOfxStatOK) {
    return status;
  }
  char **values = (char **)prop->values;
  free(values[index]);
  values[index] = dup_text(value ? value : "");
  return kOfxStatOK;
}

static OfxStatus ps_set_double(OfxPropertySetHandle handle, const char *key,
                               int index, double value)
{
  if (!handle) {
    return kOfxStatErrBadHandle;
  }
  Prop *prop = NULL;
  int status = prepare_prop((PropSet *)handle, key, PROP_DOUBLE, index, &prop);
  if (status != kOfxStatOK) {
    return status;
  }
  ((double *)prop->values)[index] = value;
  return kOfxStatOK;
}

static OfxStatus ps_set_int(OfxPropertySetHandle handle, const char *key,
                            int index, int value)
{
  if (!handle) {
    return kOfxStatErrBadHandle;
  }
  Prop *prop = NULL;
  int status = prepare_prop((PropSet *)handle, key, PROP_INT, index, &prop);
  if (status != kOfxStatOK) {
    return status;
  }
  ((int *)prop->values)[index] = value;
  return kOfxStatOK;
}

static OfxStatus ps_set_pointer(OfxPropertySetHandle handle, const char *key,
                                int index, void *value)
{
  if (!handle) {
    return kOfxStatErrBadHandle;
  }
  Prop *prop = NULL;
  int status = prepare_prop((PropSet *)handle, key, PROP_POINTER, index, &prop);
  if (status != kOfxStatOK) {
    return status;
  }
  ((void **)prop->values)[index] = value;
  return kOfxStatOK;
}

static OfxStatus ps_get_string(OfxPropertySetHandle handle, const char *key,
                               int index, char **value)
{
  Prop *prop = find_prop((PropSet *)handle, key, 0);
  if (!prop || prop->kind != PROP_STRING || !value || index < 0 ||
      index >= prop->count) {
    if (value) {
      *value = NULL;
    }
    return kOfxStatErrUnknown;
  }
  *value = ((char **)prop->values)[index];
  return kOfxStatOK;
}

static OfxStatus ps_get_double(OfxPropertySetHandle handle, const char *key,
                               int index, double *value)
{
  Prop *prop = find_prop((PropSet *)handle, key, 0);
  if (!prop || prop->kind != PROP_DOUBLE || !value || index < 0 ||
      index >= prop->count) {
    return kOfxStatErrUnknown;
  }
  *value = ((double *)prop->values)[index];
  return kOfxStatOK;
}

static OfxStatus ps_get_int(OfxPropertySetHandle handle, const char *key,
                            int index, int *value)
{
  Prop *prop = find_prop((PropSet *)handle, key, 0);
  if (!prop || prop->kind != PROP_INT || !value || index < 0 ||
      index >= prop->count) {
    return kOfxStatErrUnknown;
  }
  *value = ((int *)prop->values)[index];
  return kOfxStatOK;
}

static OfxStatus ps_get_pointer(OfxPropertySetHandle handle, const char *key,
                                int index, void **value)
{
  Prop *prop = find_prop((PropSet *)handle, key, 0);
  if (!prop || prop->kind != PROP_POINTER || !value || index < 0 ||
      index >= prop->count) {
    if (value) {
      *value = NULL;
    }
    return kOfxStatErrUnknown;
  }
  *value = ((void **)prop->values)[index];
  return kOfxStatOK;
}

static OfxStatus ps_set_string_n(OfxPropertySetHandle handle, const char *key,
                                 int count, const char *const *values)
{
  for (int i = 0; i < count; i++) {
    OfxStatus status = ps_set_string(handle, key, i, values ? values[i] : NULL);
    if (status != kOfxStatOK) {
      return status;
    }
  }
  return kOfxStatOK;
}

static OfxStatus ps_set_double_n(OfxPropertySetHandle handle, const char *key,
                                 int count, const double *values)
{
  for (int i = 0; i < count; i++) {
    OfxStatus status = ps_set_double(handle, key, i, values ? values[i] : 0);
    if (status != kOfxStatOK) {
      return status;
    }
  }
  return kOfxStatOK;
}

static OfxStatus ps_set_int_n(OfxPropertySetHandle handle, const char *key,
                              int count, const int *values)
{
  for (int i = 0; i < count; i++) {
    OfxStatus status = ps_set_int(handle, key, i, values ? values[i] : 0);
    if (status != kOfxStatOK) {
      return status;
    }
  }
  return kOfxStatOK;
}

static OfxStatus ps_set_pointer_n(OfxPropertySetHandle handle, const char *key,
                                  int count, void *const *values)
{
  for (int i = 0; i < count; i++) {
    OfxStatus status = ps_set_pointer(handle, key, i, values ? values[i] : NULL);
    if (status != kOfxStatOK) {
      return status;
    }
  }
  return kOfxStatOK;
}

static OfxStatus ps_get_string_n(OfxPropertySetHandle handle, const char *key,
                                 int count, char **values)
{
  Prop *prop = find_prop((PropSet *)handle, key, 0);
  if (!prop || prop->kind != PROP_STRING || !values) {
    return kOfxStatErrUnknown;
  }
  for (int i = 0; i < count; i++) {
    values[i] = i < prop->count ? ((char **)prop->values)[i] : NULL;
  }
  return kOfxStatOK;
}

static OfxStatus ps_get_double_n(OfxPropertySetHandle handle, const char *key,
                                 int count, double *values)
{
  Prop *prop = find_prop((PropSet *)handle, key, 0);
  if (!prop || prop->kind != PROP_DOUBLE || !values) {
    return kOfxStatErrUnknown;
  }
  for (int i = 0; i < count; i++) {
    values[i] = i < prop->count ? ((double *)prop->values)[i] : 0;
  }
  return kOfxStatOK;
}

static OfxStatus ps_get_int_n(OfxPropertySetHandle handle, const char *key,
                              int count, int *values)
{
  Prop *prop = find_prop((PropSet *)handle, key, 0);
  if (!prop || prop->kind != PROP_INT || !values) {
    return kOfxStatErrUnknown;
  }
  for (int i = 0; i < count; i++) {
    values[i] = i < prop->count ? ((int *)prop->values)[i] : 0;
  }
  return kOfxStatOK;
}

static OfxStatus ps_get_pointer_n(OfxPropertySetHandle handle, const char *key,
                                  int count, void **values)
{
  Prop *prop = find_prop((PropSet *)handle, key, 0);
  if (!prop || prop->kind != PROP_POINTER || !values) {
    return kOfxStatErrUnknown;
  }
  for (int i = 0; i < count; i++) {
    values[i] = i < prop->count ? ((void **)prop->values)[i] : NULL;
  }
  return kOfxStatOK;
}

static OfxStatus ps_reset(OfxPropertySetHandle handle, const char *key)
{
  Prop *prop = find_prop((PropSet *)handle, key, 0);
  if (prop) {
    free_prop_values(prop);
  }
  return kOfxStatOK;
}

static OfxStatus ps_get_dimension(OfxPropertySetHandle handle, const char *key,
                                  int *count)
{
  if (!count) {
    return kOfxStatErrBadHandle;
  }
  Prop *prop = find_prop((PropSet *)handle, key, 0);
  *count = prop ? prop->count : 0;
  return kOfxStatOK;
}

static OfxPropertySuiteV1 g_property_suite = {
    ps_set_pointer, ps_set_string, ps_set_double, ps_set_int,
    ps_set_pointer_n, ps_set_string_n, ps_set_double_n, ps_set_int_n,
    ps_get_pointer, ps_get_string, ps_get_double, ps_get_int,
    ps_get_pointer_n, ps_get_string_n, ps_get_double_n, ps_get_int_n,
    ps_reset, ps_get_dimension};

/* ------------------------------------------------------------------------- */
/* Host state                                                                */
/* ------------------------------------------------------------------------- */

typedef struct Param
{
  char *name;
  char *type;
  PropSet props;
  int count;
  char **strings;
  double *doubles;
  int *ints;
} Param;

typedef struct Clip
{
  char *name;
  PropSet desc_props;
  PropSet inst_props;
  int inst_ready;
} Clip;

typedef struct ImageSlot
{
  PropSet props;
  void *data;
  int owned;
  int is_output;
} ImageSlot;

struct OfxHostSession
{
  OfxLibHandle lib;
  OfxPlugin *plugin;
  char *bundle;
  char *context;
  int width;
  int height;
  int depth_bytes; /* 1 = byte, 4 = float */
  const char *depth_string;
  int phase; /* 0 = describe, 1 = instance */
  int loaded;
  int instance_created;

  PropSet desc_props;
  PropSet inst_props;

  Param *params;
  int param_count;
  int param_capacity;

  Clip *clips;
  int clip_count;
  int clip_capacity;

  const float *input;
  void *input_native;
  int input_native_owned;

  ImageSlot **images;
  int image_count;
  int image_capacity;

  float *last_output;
  int last_output_valid;
  char *error;
};

static OfxHostSession *g_session = NULL;
static PropSet g_host_props;
static OfxHost g_host;
static int g_host_ready = 0;

/* Forward declarations of the suites. */
static OfxStatus param_define(OfxParamSetHandle set, const char *type,
                              const char *name, OfxPropertySetHandle *props);
static OfxStatus param_get_handle(OfxParamSetHandle set, const char *name,
                                  OfxParamHandle *param,
                                  OfxPropertySetHandle *props);
static OfxStatus param_set_get_property_set(OfxParamSetHandle set,
                                            OfxPropertySetHandle *props);
static OfxStatus param_get_property_set(OfxParamHandle param,
                                        OfxPropertySetHandle *props);
static OfxStatus param_get_value(OfxParamHandle param, ...);
static OfxStatus param_get_value_at_time(OfxParamHandle param, double time,
                                         ...);
static OfxStatus param_get_derivative(OfxParamHandle param, double time, ...);
static OfxStatus param_get_integral(OfxParamHandle param, double time1,
                                    double time2, ...);
static OfxStatus param_set_value(OfxParamHandle param, ...);
static OfxStatus param_set_value_at_time(OfxParamHandle param, double time,
                                         ...);
static OfxStatus param_get_num_keys(OfxParamHandle param, unsigned int *count);
static OfxStatus param_get_key_time(OfxParamHandle param, unsigned int index,
                                    double *time);
static OfxStatus param_get_key_index(OfxParamHandle param, double time,
                                     int direction, int *index);
static OfxStatus param_delete_key(OfxParamHandle param, double time);
static OfxStatus param_delete_all_keys(OfxParamHandle param);
static OfxStatus param_copy(OfxParamHandle to, OfxParamHandle from,
                            OfxTime offset, const OfxRangeD *range);
static OfxStatus param_edit_begin(OfxParamSetHandle set, const char *name);
static OfxStatus param_edit_end(OfxParamSetHandle set);

static OfxParameterSuiteV1 g_param_suite = {
    param_define,
    param_get_handle,
    param_set_get_property_set,
    param_get_property_set,
    param_get_value,
    param_get_value_at_time,
    param_get_derivative,
    param_get_integral,
    param_set_value,
    param_set_value_at_time,
    param_get_num_keys,
    param_get_key_time,
    param_get_key_index,
    param_delete_key,
    param_delete_all_keys,
    param_copy,
    param_edit_begin,
    param_edit_end};

static OfxStatus ie_get_property_set(OfxImageEffectHandle effect,
                                     OfxPropertySetHandle *props);
static OfxStatus ie_get_param_set(OfxImageEffectHandle effect,
                                  OfxParamSetHandle *set);
static OfxStatus ie_clip_define(OfxImageEffectHandle effect, const char *name,
                                OfxPropertySetHandle *props);
static OfxStatus ie_clip_get_handle(OfxImageEffectHandle effect,
                                    const char *name, OfxImageClipHandle *clip,
                                    OfxPropertySetHandle *props);
static OfxStatus ie_clip_get_property_set(OfxImageClipHandle clip,
                                          OfxPropertySetHandle *props);
static OfxStatus ie_clip_get_image(OfxImageClipHandle clip, OfxTime time,
                                   const OfxRectD *region,
                                   OfxPropertySetHandle *image);
static OfxStatus ie_clip_release_image(OfxPropertySetHandle image);
static OfxStatus ie_clip_get_region_of_definition(OfxImageClipHandle clip,
                                                  OfxTime time,
                                                  OfxRectD *bounds);
static int ie_abort(OfxImageEffectHandle effect);
static OfxStatus ie_image_memory_alloc(OfxImageEffectHandle effect,
                                       size_t bytes, OfxImageMemoryHandle *mem);
static OfxStatus ie_image_memory_free(OfxImageMemoryHandle mem);
static OfxStatus ie_image_memory_lock(OfxImageMemoryHandle mem, void **ptr);
static OfxStatus ie_image_memory_unlock(OfxImageMemoryHandle mem);

static OfxImageEffectSuiteV1 g_effect_suite = {
    ie_get_property_set,
    ie_get_param_set,
    ie_clip_define,
    ie_clip_get_handle,
    ie_clip_get_property_set,
    ie_clip_get_image,
    ie_clip_release_image,
    ie_clip_get_region_of_definition,
    ie_abort,
    ie_image_memory_alloc,
    ie_image_memory_free,
    ie_image_memory_lock,
    ie_image_memory_unlock};

static OfxStatus mem_alloc(void *handle, size_t bytes, void **data)
{
  (void)handle;
  if (!data) {
    return kOfxStatErrBadHandle;
  }
  *data = calloc(1, bytes ? bytes : 1);
  return *data ? kOfxStatOK : kOfxStatErrMemory;
}

static OfxStatus mem_free(void *data)
{
  free(data);
  return kOfxStatOK;
}

static OfxMemorySuiteV1 g_memory_suite = {mem_alloc, mem_free};

static unsigned int g_thread_index = 0;
static int g_thread_active = 0;

static OfxStatus mt_run(OfxThreadFunctionV1 func, unsigned int count,
                        void *arg)
{
  if (!func) {
    return kOfxStatErrValue;
  }
  /* Execute every slice, just not concurrently.  This keeps plugins that
   * explicitly ask for N threads correct while avoiding shared-state races. */
  unsigned int threads = count ? count : 1;
  for (unsigned int index = 0; index < threads; index++) {
    g_thread_index = index;
    g_thread_active = 1;
    func(index, threads, arg);
  }
  g_thread_index = 0;
  g_thread_active = 0;
  return kOfxStatOK;
}

static OfxStatus mt_num_cpus(unsigned int *count)
{
  if (count) {
    *count = 1;
  }
  return kOfxStatOK;
}

static OfxStatus mt_index(unsigned int *index)
{
  if (index) {
    *index = g_thread_index;
  }
  return kOfxStatOK;
}

static int mt_is_spawned(void)
{
  return g_thread_active;
}

static OfxStatus mt_mutex_create(OfxMutexHandle *mutex, int lock_count)
{
  (void)lock_count;
  if (!mutex) {
    return kOfxStatErrBadHandle;
  }
  *mutex = (OfxMutexHandle)calloc(1, 64);
  return *mutex ? kOfxStatOK : kOfxStatErrMemory;
}

static OfxStatus mt_mutex_destroy(const OfxMutexHandle mutex)
{
  free(mutex);
  return kOfxStatOK;
}

static OfxStatus mt_mutex_lock(const OfxMutexHandle mutex)
{
  (void)mutex;
  return kOfxStatOK;
}

static OfxStatus mt_mutex_unlock(const OfxMutexHandle mutex)
{
  (void)mutex;
  return kOfxStatOK;
}

static OfxStatus mt_mutex_try_lock(const OfxMutexHandle mutex)
{
  (void)mutex;
  return kOfxStatOK;
}

static OfxMultiThreadSuiteV1 g_thread_suite = {
    mt_run,          mt_num_cpus,     mt_index,
    mt_is_spawned,   mt_mutex_create, mt_mutex_destroy,
    mt_mutex_lock,   mt_mutex_unlock, mt_mutex_try_lock};

static OfxStatus msg_message(void *handle, const char *type, const char *id,
                             const char *format, ...)
{
  (void)handle;
  char buffer[1024];
  va_list args;
  va_start(args, format);
  vsnprintf(buffer, sizeof(buffer), format ? format : "", args);
  va_end(args);
  quiet_message(type, id, buffer);
  return kOfxStatOK;
}

static OfxStatus msg_set_persistent(void *handle, const char *type,
                                    const char *id, const char *format, ...)
{
  (void)handle;
  (void)type;
  (void)id;
  (void)format;
  return kOfxStatOK;
}

static OfxStatus msg_clear_persistent(void *handle)
{
  (void)handle;
  return kOfxStatOK;
}

static OfxMessageSuiteV1 g_message_suite = {msg_message};
static OfxMessageSuiteV2 g_message_suite_v2 = {
    msg_message, msg_set_persistent, msg_clear_persistent};

static OfxStatus progress_start(void *handle, const char *message)
{
  (void)handle;
  (void)message;
  return kOfxStatOK;
}

static OfxStatus progress_start_v2(void *handle, const char *message,
                                   const char *message_id)
{
  (void)handle;
  (void)message;
  (void)message_id;
  return kOfxStatOK;
}

static OfxStatus progress_update(void *handle, double progress)
{
  (void)handle;
  (void)progress;
  return kOfxStatOK;
}

static OfxStatus progress_end(void *handle)
{
  (void)handle;
  return kOfxStatOK;
}

static OfxProgressSuiteV1 g_progress_suite = {progress_start, progress_update,
                                               progress_end};
static OfxProgressSuiteV2 g_progress_suite_v2 = {progress_start_v2,
                                                 progress_update, progress_end};

static OfxStatus timeline_get_time(void *set, double *time)
{
  (void)set;
  if (time) {
    *time = 0;
  }
  return kOfxStatOK;
}

static OfxStatus timeline_goto_time(void *set, double time)
{
  (void)set;
  (void)time;
  return kOfxStatOK;
}

static OfxStatus timeline_get_bounds(void *set, double *first, double *last)
{
  (void)set;
  if (first) {
    *first = 0;
  }
  if (last) {
    *last = 0;
  }
  return kOfxStatOK;
}

static OfxTimeLineSuiteV1 g_timeline_suite = {
    timeline_get_time, timeline_goto_time, timeline_get_bounds};

static const void *host_fetch_suite(OfxPropertySetHandle host,
                                    const char *name, int version)
{
  (void)host;
  if (!name) {
    return NULL;
  }
  if (strcmp(name, kOfxImageEffectSuite) == 0 && version == 1) {
    return &g_effect_suite;
  }
  if (strcmp(name, kOfxPropertySuite) == 0 && version == 1) {
    return &g_property_suite;
  }
  if (strcmp(name, kOfxParameterSuite) == 0 && version == 1) {
    return &g_param_suite;
  }
  if (strcmp(name, kOfxMemorySuite) == 0 && version == 1) {
    return &g_memory_suite;
  }
  if (strcmp(name, kOfxMultiThreadSuite) == 0 && version == 1) {
    return &g_thread_suite;
  }
  if (strcmp(name, kOfxMessageSuite) == 0) {
    if (version == 1) {
      return &g_message_suite;
    }
    if (version == 2) {
      return &g_message_suite_v2;
    }
  }
  if (strcmp(name, kOfxProgressSuite) == 0) {
    if (version == 1) {
      return &g_progress_suite;
    }
    if (version == 2) {
      return &g_progress_suite_v2;
    }
  }
  if (strcmp(name, kOfxTimeLineSuite) == 0 && version == 1) {
    return &g_timeline_suite;
  }
  return NULL;
}

static void init_host(void)
{
  if (g_host_ready) {
    return;
  }
  g_host_ready = 1;

  ps_set_string(&g_host_props, kOfxPropType, 0, kOfxTypeImageEffectHost);
  ps_set_string(&g_host_props, kOfxPropName, 0, "com.aicut.ofxhost");
  ps_set_string(&g_host_props, kOfxPropLabel, 0, "AI Cut OFX Host");
  ps_set_string(&g_host_props, kOfxPropVersionLabel, 0, OFX_HOST_VERSION);
  ps_set_int(&g_host_props, kOfxPropAPIVersion, 0, 1);
  ps_set_int(&g_host_props, kOfxPropAPIVersion, 1, 5);
  ps_set_int(&g_host_props, kOfxPropVersion, 0, 0);
  ps_set_int(&g_host_props, kOfxPropVersion, 1, 1);
  ps_set_int(&g_host_props, kOfxPropVersion, 2, 0);
  ps_set_pointer(&g_host_props, kOfxPropHostOSHandle, 0, NULL);

  ps_set_int(&g_host_props, kOfxImageEffectHostPropIsBackground, 0, 1);
  ps_set_int(&g_host_props, kOfxImageEffectPropSupportsOverlays, 0, 0);
  ps_set_int(&g_host_props, kOfxImageEffectPropSupportsMultiResolution, 0, 0);
  ps_set_int(&g_host_props, kOfxImageEffectPropSupportsTiles, 0, 0);
  ps_set_int(&g_host_props, kOfxImageEffectPropTemporalClipAccess, 0, 0);
  ps_set_int(&g_host_props, kOfxImageEffectPropSupportsMultipleClipDepths, 0,
             0);
  ps_set_int(&g_host_props, kOfxImageEffectPropSupportsMultipleClipPARs, 0, 0);
  ps_set_int(&g_host_props, kOfxImageEffectPropSetableFrameRate, 0, 0);
  ps_set_int(&g_host_props, kOfxImageEffectPropSetableFielding, 0, 0);
  ps_set_int(&g_host_props, kOfxImageEffectInstancePropSequentialRender, 0, 0);
  ps_set_int(&g_host_props, kOfxImageEffectPropRenderQualityDraft, 0, 0);

  ps_set_int(&g_host_props, kOfxParamHostPropSupportsStringAnimation, 0, 0);
  ps_set_int(&g_host_props, kOfxParamHostPropSupportsCustomInteract, 0, 0);
  ps_set_int(&g_host_props, kOfxParamHostPropSupportsChoiceAnimation, 0, 0);
  ps_set_int(&g_host_props, kOfxParamHostPropSupportsStrChoice, 0, 0);
  ps_set_int(&g_host_props, kOfxParamHostPropSupportsStrChoiceAnimation, 0, 0);
  ps_set_int(&g_host_props, kOfxParamHostPropSupportsBooleanAnimation, 0, 0);
  ps_set_int(&g_host_props, kOfxParamHostPropSupportsCustomAnimation, 0, 0);
  ps_set_int(&g_host_props, kOfxParamHostPropSupportsParametricAnimation, 0, 0);
  ps_set_int(&g_host_props, kOfxParamHostPropMaxParameters, 0, 2000);
  ps_set_int(&g_host_props, kOfxParamHostPropMaxPages, 0, 100);
  ps_set_int(&g_host_props, kOfxParamHostPropPageRowColumnCount, 0, 1);
  ps_set_int(&g_host_props, kOfxParamHostPropPageRowColumnCount, 1, 1);

  ps_set_int(&g_host_props, "OfxImageEffectPropOpenCLRenderSupported", 0, 0);
  ps_set_int(&g_host_props, "OfxImageEffectPropCudaRenderSupported", 0, 0);
  ps_set_int(&g_host_props, "OfxImageEffectPropCudaStreamSupported", 0, 0);
  ps_set_int(&g_host_props, "OfxImageEffectPropMetalRenderSupported", 0, 0);
  ps_set_string(&g_host_props, kOfxImageEffectHostPropNativeOrigin, 0,
                kOfxHostNativeOriginBottomLeft);

  ps_set_string(&g_host_props, kOfxImageEffectPropSupportedComponents, 0,
                kOfxImageComponentRGBA);
  ps_set_string(&g_host_props, kOfxImageEffectPropSupportedContexts, 0,
                kOfxImageEffectContextFilter);
  ps_set_string(&g_host_props, kOfxImageEffectPropSupportedContexts, 1,
                kOfxImageEffectContextGeneral);
  ps_set_string(&g_host_props, kOfxImageEffectPropSupportedContexts, 2,
                kOfxImageEffectContextGenerator);
  ps_set_string(&g_host_props, kOfxImageEffectPropSupportedContexts, 3,
                kOfxImageEffectContextTransition);

  ps_set_string(&g_host_props, kOfxImageEffectPropSupportedPixelDepths, 0,
                kOfxBitDepthByte);
  ps_set_string(&g_host_props, kOfxImageEffectPropSupportedPixelDepths, 1,
                kOfxBitDepthShort);
  ps_set_string(&g_host_props, kOfxImageEffectPropSupportedPixelDepths, 2,
                kOfxBitDepthFloat);

  g_host.host = &g_host_props;
  g_host.fetchSuite = host_fetch_suite;
}

/* ------------------------------------------------------------------------- */
/* Param helpers                                                             */
/* ------------------------------------------------------------------------- */

static int param_component_count(const char *type)
{
  if (!type) {
    return 1;
  }
  if (strcmp(type, kOfxParamTypeRGBA) == 0) {
    return 4;
  }
  if (strcmp(type, kOfxParamTypeRGB) == 0) {
    return 3;
  }
  if (strcmp(type, kOfxParamTypeDouble2D) == 0 ||
      strcmp(type, kOfxParamTypeInteger2D) == 0) {
    return 2;
  }
  if (strcmp(type, kOfxParamTypeDouble3D) == 0 ||
      strcmp(type, kOfxParamTypeInteger3D) == 0) {
    return 3;
  }
  if (strcmp(type, kOfxParamTypeGroup) == 0 ||
      strcmp(type, kOfxParamTypePage) == 0 ||
      strcmp(type, kOfxParamTypePushButton) == 0) {
    return 0;
  }
  return 1;
}

static int param_is_string_type(const char *type)
{
  return type && (strcmp(type, kOfxParamTypeString) == 0 ||
                  strcmp(type, kOfxParamTypeCustom) == 0 ||
                  strcmp(type, kOfxParamTypeBytes) == 0 ||
                  strcmp(type, kOfxParamTypeStrChoice) == 0);
}

static int param_is_double_type(const char *type)
{
  return type && (strcmp(type, kOfxParamTypeDouble) == 0 ||
                  strcmp(type, kOfxParamTypeRGBA) == 0 ||
                  strcmp(type, kOfxParamTypeRGB) == 0 ||
                  strcmp(type, kOfxParamTypeDouble2D) == 0 ||
                  strcmp(type, kOfxParamTypeDouble3D) == 0);
}

static const char *param_type_label(const char *type)
{
  if (!type) {
    return "unknown";
  }
  if (strcmp(type, kOfxParamTypeInteger) == 0) {
    return "integer";
  }
  if (strcmp(type, kOfxParamTypeDouble) == 0) {
    return "double";
  }
  if (strcmp(type, kOfxParamTypeBoolean) == 0) {
    return "boolean";
  }
  if (strcmp(type, kOfxParamTypeChoice) == 0) {
    return "choice";
  }
  if (strcmp(type, kOfxParamTypeStrChoice) == 0) {
    return "strchoice";
  }
  if (strcmp(type, kOfxParamTypeRGBA) == 0) {
    return "rgba";
  }
  if (strcmp(type, kOfxParamTypeRGB) == 0) {
    return "rgb";
  }
  if (strcmp(type, kOfxParamTypeDouble2D) == 0) {
    return "double2d";
  }
  if (strcmp(type, kOfxParamTypeInteger2D) == 0) {
    return "integer2d";
  }
  if (strcmp(type, kOfxParamTypeDouble3D) == 0) {
    return "double3d";
  }
  if (strcmp(type, kOfxParamTypeInteger3D) == 0) {
    return "integer3d";
  }
  if (strcmp(type, kOfxParamTypeString) == 0) {
    return "string";
  }
  if (strcmp(type, kOfxParamTypeCustom) == 0) {
    return "custom";
  }
  if (strcmp(type, kOfxParamTypeBytes) == 0) {
    return "bytes";
  }
  if (strcmp(type, kOfxParamTypeGroup) == 0) {
    return "group";
  }
  if (strcmp(type, kOfxParamTypePage) == 0) {
    return "page";
  }
  if (strcmp(type, kOfxParamTypePushButton) == 0) {
    return "pushbutton";
  }
  return "unknown";
}

static void param_free(Param *param)
{
  if (!param) {
    return;
  }
  free(param->name);
  free(param->type);
  if (param->strings) {
    for (int i = 0; i < param->count; i++) {
      free(param->strings[i]);
    }
  }
  free(param->strings);
  free(param->doubles);
  free(param->ints);
  prop_set_free(&param->props);
  memset(param, 0, sizeof(*param));
}

static Param *find_param(const char *name)
{
  if (!g_session || !name) {
    return NULL;
  }
  for (int i = 0; i < g_session->param_count; i++) {
    if (strcmp(g_session->params[i].name, name) == 0) {
      return &g_session->params[i];
    }
  }
  return NULL;
}

static void param_init_values(Param *param)
{
  if (!param || !param->type) {
    return;
  }
  int count = param_component_count(param->type);
  if (count <= 0) {
    return;
  }
  param->count = count;

  if (param_is_string_type(param->type)) {
    param->strings = (char **)calloc((size_t)count, sizeof(char *));
    char *value = NULL;
    ps_get_string(&param->props, kOfxParamPropDefault, 0, &value);
    param->strings[0] = dup_text(value ? value : "");
    return;
  }

  if (param_is_double_type(param->type)) {
    param->doubles = (double *)calloc((size_t)count, sizeof(double));
    int dimension = 0;
    ps_get_dimension(&param->props, kOfxParamPropDefault, &dimension);
    for (int i = 0; i < count; i++) {
      double value = 0;
      if (i < dimension) {
        ps_get_double(&param->props, kOfxParamPropDefault, i, &value);
      } else if (dimension == 1) {
        ps_get_double(&param->props, kOfxParamPropDefault, 0, &value);
      }
      param->doubles[i] = value;
    }
    return;
  }

  param->ints = (int *)calloc((size_t)count, sizeof(int));
  for (int i = 0; i < count; i++) {
    int value = 0;
    ps_get_int(&param->props, kOfxParamPropDefault, i, &value);
    param->ints[i] = value;
  }
}

static void param_assign_string(Param *param, const char *value)
{
  if (!param->strings) {
    param->strings = (char **)calloc((size_t)(param->count > 0 ? param->count : 1),
                                     sizeof(char *));
  }
  int index = param->count > 1 ? 0 : 0;
  free(param->strings[index]);
  param->strings[index] = dup_text(value ? value : "");
}

static void param_assign_int(Param *param, int value)
{
  if (!param->ints) {
    param->ints = (int *)calloc((size_t)(param->count > 0 ? param->count : 1),
                                sizeof(int));
  }
  param->ints[0] = value;
}

static void param_assign_doubles(Param *param, const double *values, int count)
{
  if (!param->doubles) {
    param->doubles = (double *)calloc((size_t)(param->count > 0 ? param->count : 1),
                                      sizeof(double));
  }
  for (int i = 0; i < param->count; i++) {
    param->doubles[i] = i < count ? values[i] : (count == 1 ? values[0] : 0);
  }
}

static int param_choice_index(Param *param, const char *value)
{
  int count = 0;
  ps_get_dimension(&param->props, kOfxParamPropChoiceOption, &count);
  if (count <= 0) {
    ps_get_dimension(&param->props, kOfxParamPropChoiceEnum, &count);
  }
  for (int i = 0; i < count; i++) {
    char *option = NULL;
    const char *key = kOfxParamPropChoiceOption;
    if (ps_get_string(&param->props, key, i, &option) != kOfxStatOK) {
      key = kOfxParamPropChoiceEnum;
      if (ps_get_string(&param->props, key, i, &option) != kOfxStatOK) {
        continue;
      }
    }
    if (option && strcmp(option, value) == 0) {
      return i;
    }
  }
  return -1;
}

static void apply_param_values(const OfxHostParamValue *values, int count)
{
  if (!g_session || !values) {
    return;
  }
  for (int i = 0; i < count; i++) {
    Param *param = find_param(values[i].name);
    if (!param) {
      continue;
    }
    if (param_is_string_type(param->type)) {
      const char *text = values[i].s;
      if (!text && strcmp(param->type, kOfxParamTypeStrChoice) == 0) {
        int index = values[i].i;
        char *option = NULL;
        int dimension = 0;
        ps_get_dimension(&param->props, kOfxParamPropChoiceOption, &dimension);
        if (index >= 0 && index < dimension &&
            ps_get_string(&param->props, kOfxParamPropChoiceOption, index,
                          &option) == kOfxStatOK) {
          text = option;
        }
      }
      param_assign_string(param, text);
      continue;
    }
    if (strcmp(param->type, kOfxParamTypeChoice) == 0) {
      if (values[i].s && values[i].s[0]) {
        int index = param_choice_index(param, values[i].s);
        param_assign_int(param, index >= 0 ? index : values[i].i);
      } else {
        param_assign_int(param, values[i].i);
      }
      continue;
    }
    if (param_is_double_type(param->type)) {
      double direct[4] = {values[i].d[0], values[i].d[1], values[i].d[2],
                          values[i].d[3]};
      param_assign_doubles(param, direct, 4);
      continue;
    }
    param_assign_int(param, values[i].i);
  }
}

/* ------------------------------------------------------------------------- */
/* Parameter suite                                                           */
/* ------------------------------------------------------------------------- */

static OfxStatus param_define(OfxParamSetHandle set, const char *type,
                              const char *name, OfxPropertySetHandle *props)
{
  (void)set;
  if (!g_session || !name || !type || !props) {
    return kOfxStatErrBadHandle;
  }
  if (!g_session->params) {
    g_session->params =
        (Param *)calloc(OFX_HOST_MAX_PARAMS, sizeof(Param));
    if (!g_session->params) {
      return kOfxStatErrMemory;
    }
    g_session->param_capacity = OFX_HOST_MAX_PARAMS;
  }
  if (g_session->param_count + 1 > g_session->param_capacity) {
    return kOfxStatErrMemory;
  }
  Param *param = &g_session->params[g_session->param_count++];
  memset(param, 0, sizeof(*param));
  param->name = dup_text(name);
  param->type = dup_text(type);
  ps_set_string(&param->props, kOfxParamPropType, 0, type);
  ps_set_string(&param->props, kOfxParamPropScriptName, 0, name);
  ps_set_string(&param->props, kOfxPropLabel, 0, name);
  ps_set_string(&param->props, kOfxPropShortLabel, 0, name);
  ps_set_string(&param->props, kOfxPropLongLabel, 0, name);
  /* The OFX Support library reads some of these with throwOnFailure enabled
   * while describing a param, so a missing optional property turns into a
   * failed DescribeInContext.  Seed the documented defaults. */
  ps_set_string(&param->props, kOfxParamPropHint, 0, "");
  ps_set_string(&param->props, kOfxParamPropParent, 0, "");
  ps_set_int(&param->props, kOfxParamPropSecret, 0, 0);
  ps_set_int(&param->props, kOfxParamPropEnabled, 0, 1);
  ps_set_int(&param->props, kOfxParamPropAnimates, 0,
             strcmp(type, kOfxParamTypeGroup) != 0 &&
                     strcmp(type, kOfxParamTypePage) != 0 &&
                     strcmp(type, kOfxParamTypePushButton) != 0);
  ps_set_int(&param->props, kOfxParamPropCanUndo, 0, 1);
  ps_set_int(&param->props, kOfxParamPropEvaluateOnChange, 0, 1);
  ps_set_int(&param->props, kOfxParamPropPersistant, 0, 1);
  *props = &param->props;
  return kOfxStatOK;
}

static OfxStatus param_get_handle(OfxParamSetHandle set, const char *name,
                                  OfxParamHandle *param,
                                  OfxPropertySetHandle *props)
{
  (void)set;
  Param *found = find_param(name);
  if (!found) {
    return kOfxStatErrBadHandle;
  }
  if (param) {
    *param = (OfxParamHandle)found;
  }
  if (props) {
    *props = &found->props;
  }
  return kOfxStatOK;
}

static OfxStatus param_set_get_property_set(OfxParamSetHandle set,
                                            OfxPropertySetHandle *props)
{
  (void)set;
  if (!g_session || !props) {
    return kOfxStatErrBadHandle;
  }
  *props = g_session->phase == 0 ? &g_session->desc_props
                                 : &g_session->inst_props;
  return kOfxStatOK;
}

static OfxStatus param_get_property_set(OfxParamHandle param,
                                        OfxPropertySetHandle *props)
{
  if (!param || !props) {
    return kOfxStatErrBadHandle;
  }
  *props = &((Param *)param)->props;
  return kOfxStatOK;
}

static OfxStatus param_read_values(Param *value, va_list args)
{
  if (param_is_string_type(value->type)) {
    char **out = va_arg(args, char **);
    if (out) {
      *out = value->strings ? value->strings[0] : "";
    }
  } else if (param_is_double_type(value->type)) {
    int count = param_component_count(value->type);
    for (int i = 0; i < count; i++) {
      double *out = va_arg(args, double *);
      if (out) {
        *out = value->doubles ? value->doubles[i] : 0;
      }
    }
  } else {
    int count = param_component_count(value->type);
    for (int i = 0; i < count; i++) {
      int *out = va_arg(args, int *);
      if (out) {
        *out = value->ints ? value->ints[i] : 0;
      }
    }
  }
  return kOfxStatOK;
}

static OfxStatus param_get_value(OfxParamHandle param, ...)
{
  if (!param) {
    return kOfxStatErrBadHandle;
  }
  va_list args;
  va_start(args, param);
  OfxStatus status = param_read_values((Param *)param, args);
  va_end(args);
  return status;
}

static OfxStatus param_get_value_at_time(OfxParamHandle param, double time,
                                         ...)
{
  (void)time;
  if (!param) {
    return kOfxStatErrBadHandle;
  }
  va_list args;
  va_start(args, time);
  OfxStatus status = param_read_values((Param *)param, args);
  va_end(args);
  return status;
}

static OfxStatus param_get_derivative(OfxParamHandle param, double time, ...)
{
  (void)param;
  (void)time;
  return kOfxStatErrUnsupported;
}

static OfxStatus param_get_integral(OfxParamHandle param, double time1,
                                    double time2, ...)
{
  (void)param;
  (void)time1;
  (void)time2;
  return kOfxStatErrUnsupported;
}

static OfxStatus param_set_value(OfxParamHandle param, ...)
{
  if (!param) {
    return kOfxStatErrBadHandle;
  }
  Param *value = (Param *)param;
  va_list args;
  va_start(args, param);
  if (param_is_string_type(value->type)) {
    const char *text = va_arg(args, const char *);
    param_assign_string(value, text);
  } else if (param_is_double_type(value->type)) {
    int count = param_component_count(value->type);
    double values[4] = {0, 0, 0, 0};
    for (int i = 0; i < count; i++) {
      values[i] = va_arg(args, double);
    }
    param_assign_doubles(value, values, count);
  } else {
    int first = va_arg(args, int);
    param_assign_int(value, first);
  }
  va_end(args);
  return kOfxStatOK;
}

static OfxStatus param_set_value_at_time(OfxParamHandle param, double time,
                                         ...)
{
  (void)param;
  (void)time;
  return kOfxStatOK;
}

static OfxStatus param_get_num_keys(OfxParamHandle param, unsigned int *count)
{
  (void)param;
  if (count) {
    *count = 0;
  }
  return kOfxStatOK;
}

static OfxStatus param_get_key_time(OfxParamHandle param, unsigned int index,
                                    double *time)
{
  (void)param;
  (void)index;
  (void)time;
  return kOfxStatErrBadIndex;
}

static OfxStatus param_get_key_index(OfxParamHandle param, double time,
                                     int direction, int *index)
{
  (void)param;
  (void)time;
  (void)direction;
  (void)index;
  return kOfxStatErrBadIndex;
}

static OfxStatus param_delete_key(OfxParamHandle param, double time)
{
  (void)param;
  (void)time;
  return kOfxStatOK;
}

static OfxStatus param_delete_all_keys(OfxParamHandle param)
{
  (void)param;
  return kOfxStatOK;
}

static OfxStatus param_copy(OfxParamHandle to, OfxParamHandle from,
                            OfxTime offset, const OfxRangeD *range)
{
  (void)to;
  (void)from;
  (void)offset;
  (void)range;
  return kOfxStatOK;
}

static OfxStatus param_edit_begin(OfxParamSetHandle set, const char *name)
{
  (void)set;
  (void)name;
  return kOfxStatOK;
}

static OfxStatus param_edit_end(OfxParamSetHandle set)
{
  (void)set;
  return kOfxStatOK;
}

/* ------------------------------------------------------------------------- */
/* Clips and images                                                          */
/* ------------------------------------------------------------------------- */

static Clip *find_clip(const char *name)
{
  if (!g_session || !name) {
    return NULL;
  }
  for (int i = 0; i < g_session->clip_count; i++) {
    if (strcmp(g_session->clips[i].name, name) == 0) {
      return &g_session->clips[i];
    }
  }
  return NULL;
}

static void clip_free(Clip *clip)
{
  if (!clip) {
    return;
  }
  free(clip->name);
  prop_set_free(&clip->desc_props);
  prop_set_free(&clip->inst_props);
  memset(clip, 0, sizeof(*clip));
}

static void clip_ensure_instance_props(Clip *clip)
{
  if (!clip || clip->inst_ready || !g_session) {
    return;
  }
  clip->inst_ready = 1;
  PropSet *props = &clip->inst_props;

  ps_set_string(props, kOfxPropType, 0, kOfxTypeClip);
  ps_set_string(props, kOfxPropName, 0, clip->name);
  ps_set_string(props, kOfxPropLabel, 0, clip->name);
  ps_set_string(props, kOfxPropShortLabel, 0, clip->name);
  ps_set_string(props, kOfxPropLongLabel, 0, clip->name);

  int dimension = 0;
  ps_get_dimension(&clip->desc_props, kOfxImageEffectPropSupportedComponents,
                   &dimension);
  for (int i = 0; i < dimension; i++) {
    char *component = NULL;
    if (ps_get_string(&clip->desc_props, kOfxImageEffectPropSupportedComponents,
                      i, &component) == kOfxStatOK) {
      ps_set_string(props, kOfxImageEffectPropSupportedComponents, i,
                    component);
    }
  }

  ps_set_string(props, kOfxImageClipPropFieldExtraction, 0,
                kOfxImageFieldDoubled);
  ps_set_string(props, kOfxImageEffectPropPixelDepth, 0,
                g_session->depth_string);
  ps_set_string(props, kOfxImageEffectPropComponents, 0,
                kOfxImageComponentRGBA);
  ps_set_string(props, kOfxImageClipPropUnmappedPixelDepth, 0,
                g_session->depth_string);
  ps_set_string(props, kOfxImageClipPropUnmappedComponents, 0,
                kOfxImageComponentRGBA);
  ps_set_string(props, kOfxImageEffectPropPreMultiplication, 0,
                kOfxImageOpaque);
  ps_set_string(props, kOfxImageClipPropFieldOrder, 0, kOfxImageFieldNone);

  int optional = 0;
  int is_mask = 0;
  int tiles = 1;
  ps_get_int(&clip->desc_props, kOfxImageClipPropOptional, 0, &optional);
  ps_get_int(&clip->desc_props, kOfxImageClipPropIsMask, 0, &is_mask);
  ps_get_int(&clip->desc_props, kOfxImageEffectPropSupportsTiles, 0, &tiles);

  ps_set_int(props, kOfxImageEffectPropTemporalClipAccess, 0, 0);
  ps_set_int(props, kOfxImageClipPropOptional, 0, optional);
  ps_set_int(props, kOfxImageClipPropIsMask, 0, is_mask);
  ps_set_int(props, kOfxImageEffectPropSupportsTiles, 0, tiles);
  ps_set_int(props, kOfxImageClipPropConnected, 0, 1);
  ps_set_int(props, kOfxImageClipPropContinuousSamples, 0, 0);
  ps_set_double(props, kOfxImagePropPixelAspectRatio, 0, 1);
  ps_set_double(props, kOfxImageEffectPropFrameRate, 0, 24);
  ps_set_double(props, kOfxImageEffectPropFrameRange, 0, 0);
  ps_set_double(props, kOfxImageEffectPropFrameRange, 1, 0);
  ps_set_double(props, kOfxImageEffectPropUnmappedFrameRate, 0, 24);
  ps_set_double(props, kOfxImageEffectPropUnmappedFrameRange, 0, 0);
  ps_set_double(props, kOfxImageEffectPropUnmappedFrameRange, 1, 0);
}

static OfxStatus ie_clip_define(OfxImageEffectHandle effect, const char *name,
                                OfxPropertySetHandle *props)
{
  (void)effect;
  if (!g_session || !name || !props) {
    return kOfxStatErrBadHandle;
  }
  if (!g_session->clips) {
    g_session->clips = (Clip *)calloc(OFX_HOST_MAX_CLIPS, sizeof(Clip));
    if (!g_session->clips) {
      return kOfxStatErrMemory;
    }
    g_session->clip_capacity = OFX_HOST_MAX_CLIPS;
  }
  if (g_session->clip_count + 1 > g_session->clip_capacity) {
    return kOfxStatErrMemory;
  }
  Clip *clip = &g_session->clips[g_session->clip_count++];
  memset(clip, 0, sizeof(*clip));
  clip->name = dup_text(name);
  *props = &clip->desc_props;
  return kOfxStatOK;
}

static OfxStatus ie_clip_get_handle(OfxImageEffectHandle effect,
                                    const char *name, OfxImageClipHandle *clip,
                                    OfxPropertySetHandle *props)
{
  (void)effect;
  Clip *found = find_clip(name);
  if (!found) {
    return kOfxStatErrBadHandle;
  }
  clip_ensure_instance_props(found);
  if (clip) {
    *clip = (OfxImageClipHandle)found;
  }
  if (props) {
    *props = &found->inst_props;
  }
  return kOfxStatOK;
}

static OfxStatus ie_clip_get_property_set(OfxImageClipHandle clip,
                                          OfxPropertySetHandle *props)
{
  if (!clip || !props) {
    return kOfxStatErrBadHandle;
  }
  *props = &((Clip *)clip)->inst_props;
  return kOfxStatOK;
}

static void setup_image_props(ImageSlot *slot, void *data, int owned,
                              int is_output)
{
  if (!slot || !g_session) {
    return;
  }
  slot->data = data;
  slot->owned = owned;
  slot->is_output = is_output;
  PropSet *props = &slot->props;
  int row_bytes =
      g_session->width * 4 * g_session->depth_bytes;

  ps_set_string(props, kOfxPropType, 0, kOfxTypeImage);
  ps_set_string(props, kOfxImageEffectPropPixelDepth, 0,
                g_session->depth_string);
  ps_set_string(props, kOfxImageEffectPropComponents, 0,
                kOfxImageComponentRGBA);
  ps_set_string(props, kOfxImageEffectPropPreMultiplication, 0,
                kOfxImageOpaque);
  ps_set_string(props, kOfxImagePropField, 0, kOfxImageFieldNone);
  ps_set_string(props, kOfxImagePropUniqueIdentifier, 0,
                is_output ? "aicuthost-output" : "aicuthost-input");
  ps_set_double(props, kOfxImageEffectPropRenderScale, 0, 1);
  ps_set_double(props, kOfxImageEffectPropRenderScale, 1, 1);
  ps_set_double(props, kOfxImagePropPixelAspectRatio, 0, 1);
  ps_set_pointer(props, kOfxImagePropData, 0, data);
  ps_set_int(props, kOfxImagePropBounds, 0, 0);
  ps_set_int(props, kOfxImagePropBounds, 1, 0);
  ps_set_int(props, kOfxImagePropBounds, 2, g_session->width);
  ps_set_int(props, kOfxImagePropBounds, 3, g_session->height);
  ps_set_int(props, kOfxImagePropRegionOfDefinition, 0, 0);
  ps_set_int(props, kOfxImagePropRegionOfDefinition, 1, 0);
  ps_set_int(props, kOfxImagePropRegionOfDefinition, 2, g_session->width);
  ps_set_int(props, kOfxImagePropRegionOfDefinition, 3, g_session->height);
  ps_set_int(props, kOfxImagePropRowBytes, 0, row_bytes);
}

/* OFX canonical coordinates are bottom-left; ffmpeg and the rest of the app
 * are top-down.  Flipping here keeps spatial effects (blur, transform, ...)
 * oriented the same way as the editor and export pipeline. */
static void capture_output(ImageSlot *slot)
{
  if (!slot || !slot->is_output || !g_session || !slot->data) {
    return;
  }
  int width = g_session->width;
  int height = g_session->height;
  size_t row = (size_t)width * 4;
  float *converted = (float *)malloc((size_t)width * (size_t)height * 4 *
                                     sizeof(float));
  if (!converted) {
    return;
  }
  if (g_session->depth_bytes == 4) {
    const float *source = (const float *)slot->data;
    for (int y = 0; y < height; y++) {
      memcpy(converted + (size_t)y * row,
             source + (size_t)(height - 1 - y) * row, row * sizeof(float));
    }
  } else if (g_session->depth_bytes == 2) {
    const unsigned short *source = (const unsigned short *)slot->data;
    for (int y = 0; y < height; y++) {
      const unsigned short *src_row =
          source + (size_t)(height - 1 - y) * row;
      float *dst_row = converted + (size_t)y * row;
      for (size_t i = 0; i < row; i++) {
        dst_row[i] = (float)src_row[i] / 65535.0f;
      }
    }
  } else {
    const unsigned char *source = (const unsigned char *)slot->data;
    for (int y = 0; y < height; y++) {
      const unsigned char *src_row = source + (size_t)(height - 1 - y) * row;
      float *dst_row = converted + (size_t)y * row;
      for (size_t i = 0; i < row; i++) {
        dst_row[i] = (float)src_row[i] / 255.0f;
      }
    }
  }
  free(g_session->last_output);
  g_session->last_output = converted;
  g_session->last_output_valid = 1;
}

static OfxStatus ie_clip_get_image(OfxImageClipHandle clip, OfxTime time,
                                   const OfxRectD *region,
                                   OfxPropertySetHandle *image)
{
  (void)time;
  (void)region;
  if (!g_session || !clip || !image) {
    return kOfxStatErrBadHandle;
  }
  Clip *source = (Clip *)clip;
  int is_output = strcmp(source->name, kOfxImageEffectOutputClipName) == 0;

  ImageSlot *slot = (ImageSlot *)calloc(1, sizeof(ImageSlot));
  if (!slot) {
    return kOfxStatErrMemory;
  }

  size_t row_bytes =
      (size_t)g_session->width * 4 * (size_t)g_session->depth_bytes;
  size_t bytes = row_bytes * (size_t)g_session->height;

  if (is_output) {
    void *data = calloc(1, bytes ? bytes : 1);
    if (!data) {
      free(slot);
      return kOfxStatErrMemory;
    }
    setup_image_props(slot, data, 1, 1);
  } else {
    if (!g_session->input_native) {
      free(slot);
      return kOfxStatErrValue;
    }
    setup_image_props(slot, g_session->input_native, 0, 0);
  }

  if (g_session->image_count + 1 > g_session->image_capacity) {
    int capacity = g_session->image_capacity ? g_session->image_capacity * 2 : 8;
    ImageSlot **images = (ImageSlot **)realloc(
        g_session->images, (size_t)capacity * sizeof(ImageSlot *));
    if (!images) {
      if (slot->owned) {
        free(slot->data);
      }
      prop_set_free(&slot->props);
      free(slot);
      return kOfxStatErrMemory;
    }
    g_session->images = images;
    g_session->image_capacity = capacity;
  }
  g_session->images[g_session->image_count++] = slot;
  *image = &slot->props;
  return kOfxStatOK;
}

static void free_image_slot(ImageSlot *slot)
{
  if (!slot) {
    return;
  }
  if (slot->owned) {
    free(slot->data);
  }
  prop_set_free(&slot->props);
  free(slot);
}

static OfxStatus ie_clip_release_image(OfxPropertySetHandle image)
{
  if (!g_session || !image) {
    return kOfxStatErrBadHandle;
  }
  for (int i = 0; i < g_session->image_count; i++) {
    ImageSlot *slot = g_session->images[i];
    if (&slot->props != (PropSet *)image) {
      continue;
    }
    capture_output(slot);
    free_image_slot(slot);
    g_session->images[i] = g_session->images[g_session->image_count - 1];
    g_session->image_count--;
    return kOfxStatOK;
  }
  return kOfxStatErrBadHandle;
}

static OfxStatus ie_clip_get_region_of_definition(OfxImageClipHandle clip,
                                                  OfxTime time,
                                                  OfxRectD *bounds)
{
  (void)clip;
  (void)time;
  if (!bounds || !g_session) {
    return kOfxStatErrBadHandle;
  }
  bounds->x1 = 0;
  bounds->y1 = 0;
  bounds->x2 = g_session->width;
  bounds->y2 = g_session->height;
  return kOfxStatOK;
}

static int ie_abort(OfxImageEffectHandle effect)
{
  (void)effect;
  return 0;
}

static OfxStatus ie_image_memory_alloc(OfxImageEffectHandle effect,
                                       size_t bytes, OfxImageMemoryHandle *mem)
{
  (void)effect;
  if (!mem) {
    return kOfxStatErrBadHandle;
  }
  void **handle = (void **)calloc(1, sizeof(void *) + bytes);
  if (!handle) {
    return kOfxStatErrMemory;
  }
  *handle = (char *)handle + sizeof(void *);
  *mem = (OfxImageMemoryHandle)handle;
  return kOfxStatOK;
}

static OfxStatus ie_image_memory_free(OfxImageMemoryHandle mem)
{
  free(mem);
  return kOfxStatOK;
}

static OfxStatus ie_image_memory_lock(OfxImageMemoryHandle mem, void **ptr)
{
  if (!mem || !ptr) {
    return kOfxStatErrBadHandle;
  }
  *ptr = *(void **)mem;
  return kOfxStatOK;
}

static OfxStatus ie_image_memory_unlock(OfxImageMemoryHandle mem)
{
  (void)mem;
  return kOfxStatOK;
}

static OfxStatus ie_get_property_set(OfxImageEffectHandle effect,
                                     OfxPropertySetHandle *props)
{
  if (!effect || !props || !g_session) {
    return kOfxStatErrBadHandle;
  }
  *props = g_session->phase == 0 ? &g_session->desc_props
                                 : &g_session->inst_props;
  return kOfxStatOK;
}

static OfxStatus ie_get_param_set(OfxImageEffectHandle effect,
                                  OfxParamSetHandle *set)
{
  if (!effect || !set) {
    return kOfxStatErrBadHandle;
  }
  *set = (OfxParamSetHandle)g_session;
  return kOfxStatOK;
}

/* ------------------------------------------------------------------------- */
/* Bundle loading                                                            */
/* ------------------------------------------------------------------------- */

typedef int (*OfxGetNumberOfPluginsFn)(void);
typedef OfxPlugin *(*OfxGetPluginFn)(int);

static char *join_path(const char *base, const char *child)
{
  size_t base_len = strlen(base);
  size_t child_len = strlen(child);
  int needs_sep = base_len > 0 && base[base_len - 1] != '/' &&
                  base[base_len - 1] != '\\';
  char *out = (char *)malloc(base_len + child_len + 2);
  if (!out) {
    return NULL;
  }
  memcpy(out, base, base_len);
  if (needs_sep) {
    out[base_len++] = '/';
  }
  memcpy(out + base_len, child, child_len + 1);
  return out;
}

/* Apple double files and the __MACOSX sidecar directory are archive noise,
 * not plugin payload; never try to dlopen them. */
static int is_ignored_entry(const char *name)
{
  return name && (strcmp(name, "__MACOSX") == 0 ||
                  strncmp(name, "._", 2) == 0 ||
                  strcmp(name, ".DS_Store") == 0);
}

/* A plugin executable does not have to be called *.ofx: macOS bundles often
 * name the Mach-O after CFBundleExecutable.  Recognise the file by magic. */
static int looks_like_binary(const char *path)
{
  unsigned char h[4];
  FILE *file = fopen(path, "rb");
  if (!file) {
    return 0;
  }
  size_t read = fread(h, 1, 4, file);
  fclose(file);
  if (read < 4) {
    return 0;
  }
  if (h[0] == 'M' && h[1] == 'Z') {
    return 1;
  }
  if (h[0] == 0x7f && h[1] == 'E' && h[2] == 'L' && h[3] == 'F') {
    return 1;
  }
  if ((h[0] == 0xfe && h[1] == 0xed && h[2] == 0xfa &&
       (h[3] == 0xce || h[3] == 0xcf)) ||
      (h[0] == 0xcf && h[1] == 0xfa && h[2] == 0xed && h[3] == 0xfe) ||
      (h[0] == 0xce && h[1] == 0xfa && h[2] == 0xed && h[3] == 0xfe)) {
    return 1;
  }
  if ((h[0] == 0xca && h[1] == 0xfe && h[2] == 0xba &&
       (h[3] == 0xbe || h[3] == 0xbf)) ||
      (h[0] == 0xbe && h[1] == 0xba && h[2] == 0xfe && h[3] == 0xca) ||
      (h[0] == 0xbf && h[1] == 0xba && h[2] == 0xfe && h[3] == 0xca)) {
    return 1;
  }
  return 0;
}

static char *find_entry_recursive(const char *dir, int depth, int want_ofx)
{
  if (depth <= 0) {
    return NULL;
  }
#ifdef _WIN32
  char pattern[PATH_MAX];
  snprintf(pattern, sizeof(pattern), "%s\\*", dir);
  WIN32_FIND_DATAA data;
  HANDLE handle = FindFirstFileA(pattern, &data);
  if (handle == INVALID_HANDLE_VALUE) {
    return NULL;
  }
  char *found = NULL;
  do {
    if (strcmp(data.cFileName, ".") == 0 || strcmp(data.cFileName, "..") == 0 ||
        is_ignored_entry(data.cFileName)) {
      continue;
    }
    char *path = join_path(dir, data.cFileName);
    if (!path) {
      continue;
    }
    if ((data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) == 0) {
      if (want_ofx ? ends_with(data.cFileName, ".ofx")
                   : looks_like_binary(path)) {
        found = path;
        break;
      }
    } else {
      found = find_entry_recursive(path, depth - 1, want_ofx);
    }
    free(path);
  } while (!found && FindNextFileA(handle, &data));
  FindClose(handle);
  return found;
#else
  DIR *handle = opendir(dir);
  if (!handle) {
    return NULL;
  }
  char *found = NULL;
  struct dirent *entry;
  while (!found && (entry = readdir(handle)) != NULL) {
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0 ||
        is_ignored_entry(entry->d_name)) {
      continue;
    }
    char *path = join_path(dir, entry->d_name);
    if (!path) {
      continue;
    }
    if (is_file(path)) {
      if (want_ofx ? ends_with(entry->d_name, ".ofx")
                   : looks_like_binary(path)) {
        found = path;
        break;
      }
    } else if (is_dir(path)) {
      found = find_entry_recursive(path, depth - 1, want_ofx);
    }
    free(path);
  }
  closedir(handle);
  return found;
#endif
}

static char *find_ofx_recursive(const char *dir, int depth)
{
  return find_entry_recursive(dir, depth, 1);
}

static char *find_binary_recursive(const char *dir, int depth)
{
  return find_entry_recursive(dir, depth, 0);
}

static char *plist_executable(const char *bundle)
{
  char info[PATH_MAX];
  snprintf(info, sizeof(info), "%s/Contents/Info.plist", bundle);
  FILE *file = fopen(info, "rb");
  if (!file) {
    return NULL;
  }
  char buffer[65536];
  size_t read = fread(buffer, 1, sizeof(buffer) - 1, file);
  fclose(file);
  buffer[read] = '\0';

  const char *key = strstr(buffer, "CFBundleExecutable");
  if (!key) {
    return NULL;
  }
  const char *start = strstr(key, "<string>");
  if (!start) {
    return NULL;
  }
  start += 8;
  const char *end = strstr(start, "</string>");
  if (!end || end <= start || (size_t)(end - start) >= 256) {
    return NULL;
  }
  char name[256];
  size_t length = (size_t)(end - start);
  memcpy(name, start, length);
  name[length] = '\0';
  while (length > 0 && (name[length - 1] == ' ' || name[length - 1] == '\n')) {
    name[--length] = '\0';
  }
  if (length == 0) {
    return NULL;
  }

  char *dir = join_path(bundle, "Contents/MacOS");
  if (!dir) {
    return NULL;
  }
  char *path = join_path(dir, name);
  free(dir);
  if (path && is_file(path)) {
    return path;
  }
  free(path);
  return NULL;
}

static char *resolve_bundle(const char *bundle, char **error)
{
  if (!bundle || !bundle[0]) {
    set_error(error, "插件路径为空");
    return NULL;
  }
  if (is_file(bundle)) {
    return dup_text(bundle);
  }
  if (!is_dir(bundle)) {
    set_error(error, "插件路径不存在：%s", bundle);
    return NULL;
  }

  char *declared = plist_executable(bundle);
  if (declared) {
    return declared;
  }

  const char *candidates[] = {
      "Contents/MacOS",
      "Contents/Linux-x86-64",
      "Contents/Linux-aarch64",
      "Contents/Win64",
      "Contents/Win32",
      "MacOS",
      "Win64",
      "Win32",
      "bin",
      "lib",
      ".",
  };
  /* Prefer an explicitly named .ofx file, then any executable-looking file
   * (macOS bundles usually carry their CFBundleExecutable here). */
  for (int want_ofx = 1; want_ofx >= 0; want_ofx--) {
    for (size_t i = 0; i < sizeof(candidates) / sizeof(candidates[0]); i++) {
      char *dir = join_path(bundle, candidates[i]);
      if (!dir) {
        continue;
      }
      char *found = find_entry_recursive(dir, 2, want_ofx);
      free(dir);
      if (found) {
        return found;
      }
    }
  }
  char *found = find_ofx_recursive(bundle, 6);
  if (!found) {
    found = find_binary_recursive(bundle, 6);
  }
  if (!found) {
    set_error(error, "没有在 %s 里找到 OFX 二进制", bundle);
  }
  return found;
}

static void free_plugin_info(OfxHostPluginInfo *info);

static int context_supported(PropSet *props, const char *context)
{
  int count = 0;
  ps_get_dimension(props, kOfxImageEffectPropSupportedContexts, &count);
  for (int i = 0; i < count; i++) {
    char *value = NULL;
    if (ps_get_string(props, kOfxImageEffectPropSupportedContexts, i, &value) ==
            kOfxStatOK &&
        value && strcmp(value, context) == 0) {
      return 1;
    }
  }
  return 0;
}

static const char *pick_context(PropSet *props, const char *requested)
{
  if (requested && requested[0]) {
    return requested;
  }
  static const char *priority[] = {
      kOfxImageEffectContextFilter, kOfxImageEffectContextGeneral,
      kOfxImageEffectContextGenerator, kOfxImageEffectContextTransition,
      kOfxImageEffectContextPaint, kOfxImageEffectContextRetimer};
  for (size_t i = 0; i < sizeof(priority) / sizeof(priority[0]); i++) {
    if (context_supported(props, priority[i])) {
      return priority[i];
    }
  }
  return NULL;
}

static int choose_depth(PropSet *props, const char **depth_string)
{
  int count = 0;
  int has_float = 0;
  int has_short = 0;
  int has_byte = 0;
  ps_get_dimension(props, kOfxImageEffectPropSupportedPixelDepths, &count);
  for (int i = 0; i < count; i++) {
    char *value = NULL;
    if (ps_get_string(props, kOfxImageEffectPropSupportedPixelDepths, i,
                      &value) != kOfxStatOK) {
      continue;
    }
    if (value && strcmp(value, kOfxBitDepthFloat) == 0) {
      has_float = 1;
    }
    if (value && strcmp(value, kOfxBitDepthShort) == 0) {
      has_short = 1;
    }
    if (value && strcmp(value, kOfxBitDepthByte) == 0) {
      has_byte = 1;
    }
  }
  if (has_float) {
    *depth_string = kOfxBitDepthFloat;
    return 4;
  }
  if (has_short) {
    *depth_string = kOfxBitDepthShort;
    return 2;
  }
  if (has_byte) {
    *depth_string = kOfxBitDepthByte;
    return 1;
  }
  return 0;
}

/* ------------------------------------------------------------------------- */
/* Session lifecycle                                                         */
/* ------------------------------------------------------------------------- */

static void session_free_images(OfxHostSession *session)
{
  if (!session) {
    return;
  }
  for (int i = 0; i < session->image_count; i++) {
    free_image_slot(session->images[i]);
  }
  free(session->images);
  session->images = NULL;
  session->image_count = 0;
  session->image_capacity = 0;
}

static void session_free(OfxHostSession *session)
{
  if (!session) {
    return;
  }
  g_session = session;
  if (session->plugin) {
    if (session->instance_created) {
      session->phase = 1;
      session->plugin->mainEntry(kOfxActionDestroyInstance, session, NULL, NULL);
      session->instance_created = 0;
    }
    if (session->loaded) {
      session->plugin->mainEntry(kOfxActionUnload, NULL, NULL, NULL);
    }
  }
  session_free_images(session);
  for (int i = 0; i < session->param_count; i++) {
    param_free(&session->params[i]);
  }
  free(session->params);
  for (int i = 0; i < session->clip_count; i++) {
    clip_free(&session->clips[i]);
  }
  free(session->clips);
  prop_set_free(&session->desc_props);
  prop_set_free(&session->inst_props);
  free(session->last_output);
  if (session->input_native_owned) {
    free(session->input_native);
  }
  free(session->bundle);
  free(session->context);
  free(session->error);
  if (session->lib) {
    OFX_LIB_CLOSE(session->lib);
  }
  if (g_session == session) {
    g_session = NULL;
  }
  free(session);
}

static void setup_instance_props(OfxHostSession *session)
{
  PropSet *props = &session->inst_props;
  ps_set_string(props, kOfxPropType, 0, kOfxTypeImageEffectInstance);
  ps_set_string(props, kOfxImageEffectPropContext, 0, session->context);
  ps_set_int(props, kOfxImageEffectInstancePropSequentialRender, 0, 0);
  ps_set_pointer(props, kOfxPropInstanceData, 0, NULL);
  ps_set_pointer(props, kOfxImageEffectPropPluginHandle, 0, session->plugin);
  ps_set_int(props, kOfxPropIsInteractive, 0, 0);
  ps_set_double(props, kOfxImageEffectPropProjectSize, 0, session->width);
  ps_set_double(props, kOfxImageEffectPropProjectSize, 1, session->height);
  ps_set_double(props, kOfxImageEffectPropProjectExtent, 0, session->width);
  ps_set_double(props, kOfxImageEffectPropProjectExtent, 1, session->height);
  ps_set_double(props, kOfxImageEffectPropProjectOffset, 0, 0);
  ps_set_double(props, kOfxImageEffectPropProjectOffset, 1, 0);
  ps_set_double(props, kOfxImageEffectPropProjectPixelAspectRatio, 0, 1);
  ps_set_double(props, kOfxImageEffectInstancePropEffectDuration, 0, 0);
  ps_set_double(props, kOfxImageEffectPropFrameRate, 0, 24);
}

static void set_load_error(char **error, const char *binary, const char *reason)
{
#ifdef _WIN32
  (void)reason;
  set_error(error, "无法加载 OFX 插件：%s（Win32 错误 %lu）", binary,
            (unsigned long)GetLastError());
#else
  if (reason && strstr(reason, "incompatible architecture")) {
    set_error(error,
              "无法加载 OFX 插件：%s（架构不兼容：请安装与 App 相同 CPU 架构的构建）",
              binary);
  } else {
    set_error(error, "无法加载 OFX 插件：%s（%s）", binary,
              reason ? reason : "未知错误");
  }
#endif
}

OfxHostSession *ofx_host_session_open(const char *bundle, const char *plugin_id,
                                      const char *context, int width,
                                      int height, char **error)
{
  init_host();
  if (!bundle || width <= 0 || height <= 0) {
    set_error(error, "插件路径或图像尺寸无效");
    return NULL;
  }

  char *binary = resolve_bundle(bundle, error);
  if (!binary) {
    return NULL;
  }

  OfxHostSession *session = (OfxHostSession *)calloc(1, sizeof(OfxHostSession));
  if (!session) {
    free(binary);
    set_error(error, "内存不足");
    return NULL;
  }
  session->width = width;
  session->height = height;
  session->bundle = dup_text(bundle);
  session->phase = 0;
  session->last_output_valid = 0;

  session->lib = OFX_LIB_OPEN(binary);
  if (!session->lib) {
#ifdef _WIN32
    set_load_error(error, binary, NULL);
#else
    set_load_error(error, binary, dlerror());
#endif
    free(binary);
    session_free(session);
    return NULL;
  }
  free(binary);

  OfxGetNumberOfPluginsFn get_count =
      (OfxGetNumberOfPluginsFn)OFX_LIB_SYM(session->lib,
                                           "OfxGetNumberOfPlugins");
  OfxGetPluginFn get_plugin =
      (OfxGetPluginFn)OFX_LIB_SYM(session->lib, "OfxGetPlugin");
  if (!get_count || !get_plugin) {
    set_error(error, "不是 OFX 插件（缺少 OfxGetNumberOfPlugins/OfxGetPlugin）");
    session_free(session);
    return NULL;
  }

  int count = get_count();
  OfxPlugin *selected = NULL;
  for (int i = 0; i < count; i++) {
    OfxPlugin *candidate = get_plugin(i);
    if (!candidate) {
      continue;
    }
    if (!plugin_id || !plugin_id[0] ||
        (candidate->pluginIdentifier &&
         strcmp(candidate->pluginIdentifier, plugin_id) == 0)) {
      selected = candidate;
      break;
    }
  }
  if (!selected) {
    set_error(error, "插件里没有这个效果：%s", plugin_id ? plugin_id : "(null)");
    session_free(session);
    return NULL;
  }
  session->plugin = selected;

  g_session = session;
  if (selected->setHost) {
    selected->setHost(&g_host);
  }

  OfxStatus status = selected->mainEntry(kOfxActionLoad, NULL, NULL, NULL);
  if (status != kOfxStatOK && status != kOfxStatReplyDefault) {
    set_error(error, "插件 Load 失败（status=%d）", status);
    g_session = NULL;
    session_free(session);
    return NULL;
  }
  session->loaded = 1;

  status = selected->mainEntry(kOfxActionDescribe, session, NULL, NULL);
  if (status != kOfxStatOK) {
    set_error(error, "插件 Describe 失败（status=%d）", status);
    g_session = NULL;
    session_free(session);
    return NULL;
  }

  const char *chosen_context = pick_context(&session->desc_props, context);
  if (!chosen_context) {
    set_error(error, "插件不支持任何可渲染的 context");
    g_session = NULL;
    session_free(session);
    return NULL;
  }
  if (context && context[0] && !context_supported(&session->desc_props, context)) {
    set_error(error, "插件不支持 context：%s", context);
    g_session = NULL;
    session_free(session);
    return NULL;
  }
  session->context = dup_text(chosen_context);

  PropSet in_args;
  memset(&in_args, 0, sizeof(in_args));
  ps_set_string(&in_args, kOfxImageEffectPropContext, 0, session->context);
  status = selected->mainEntry(kOfxImageEffectActionDescribeInContext, session,
                               &in_args, NULL);
  prop_set_free(&in_args);
  if (status != kOfxStatOK) {
    set_error(error, "插件 DescribeInContext 失败（status=%d）", status);
    g_session = NULL;
    session_free(session);
    return NULL;
  }

  for (int i = 0; i < session->param_count; i++) {
    param_init_values(&session->params[i]);
  }

  session->depth_bytes =
      choose_depth(&session->desc_props, &session->depth_string);
  if (!session->depth_bytes) {
    set_error(error, "插件只支持 16 位/半浮点像素深度，暂不支持");
    g_session = NULL;
    session_free(session);
    return NULL;
  }

  setup_instance_props(session);
  return session;
}

void ofx_host_session_close(OfxHostSession *session)
{
  if (!session) {
    return;
  }
  /* DestroyInstance still calls back into the property/param suites, so the
   * global session must stay live until teardown has finished. */
  g_session = session;
  session_free(session);
  g_session = NULL;
}

static void prepare_input(OfxHostSession *session, const float *input)
{
  if (session->input_native_owned) {
    free(session->input_native);
    session->input_native = NULL;
    session->input_native_owned = 0;
  }
  int width = session->width;
  int height = session->height;
  size_t row = (size_t)width * 4;
  size_t pixels = row * (size_t)height;

  if (session->depth_bytes == 4) {
    float *flipped = (float *)malloc(pixels * sizeof(float));
    if (!flipped) {
      return;
    }
    for (int y = 0; y < height; y++) {
      memcpy(flipped + (size_t)y * row,
             input + (size_t)(height - 1 - y) * row, row * sizeof(float));
    }
    session->input_native = flipped;
  } else if (session->depth_bytes == 2) {
    unsigned short *shorts =
        (unsigned short *)malloc(pixels * sizeof(unsigned short));
    if (!shorts) {
      return;
    }
    for (int y = 0; y < height; y++) {
      const float *src = input + (size_t)(height - 1 - y) * row;
      unsigned short *dst = shorts + (size_t)y * row;
      for (size_t i = 0; i < row; i++) {
        float value = src[i];
        if (value < 0) {
          value = 0;
        } else if (value > 1) {
          value = 1;
        }
        dst[i] = (unsigned short)(value * 65535.0f + 0.5f);
      }
    }
    session->input_native = shorts;
  } else {
    unsigned char *bytes = (unsigned char *)malloc(pixels);
    if (!bytes) {
      return;
    }
    for (int y = 0; y < height; y++) {
      const float *src = input + (size_t)(height - 1 - y) * row;
      unsigned char *dst = bytes + (size_t)y * row;
      for (size_t i = 0; i < row; i++) {
        float value = src[i];
        if (value < 0) {
          value = 0;
        } else if (value > 1) {
          value = 1;
        }
        dst[i] = (unsigned char)(value * 255.0f + 0.5f);
      }
    }
    session->input_native = bytes;
  }
  session->input_native_owned = 1;
}

static void surface_error(OfxHostSession *session, OfxStatus status,
                         char **error)
{
  if (status == kOfxStatOK || status == kOfxStatReplyDefault) {
    return;
  }
  if (session && session->error) {
    set_error(error, "插件渲染失败（status=%d）：%s", status, session->error);
  } else {
    set_error(error, "插件渲染失败（status=%d）", status);
  }
}

int ofx_host_session_render(OfxHostSession *session, double time,
                            const float *input,
                            const OfxHostParamValue *params, int param_count,
                            float **output, char **error)
{
  if (!session || !input || !output) {
    set_error(error, "渲染参数无效");
    return -1;
  }
  if (session->image_count > 0) {
    session_free_images(session);
  }
  session->last_output_valid = 0;
  free(session->last_output);
  session->last_output = NULL;
  session->input = input;
  prepare_input(session, input);
  if (!session->input_native) {
    set_error(error, "无法准备输入像素");
    return -1;
  }

  g_session = session;
  session->phase = 1;
  apply_param_values(params, param_count);

  if (!session->instance_created) {
    OfxStatus create_status =
        session->plugin->mainEntry(kOfxActionCreateInstance, session, NULL, NULL);
    if (create_status != kOfxStatOK) {
      set_error(error, "插件 CreateInstance 失败（status=%d）", create_status);
      return -1;
    }
    session->instance_created = 1;
  }

  /* Params changed since the previous frame: let the plugin refresh any
   * private state it keeps outside the OFX parameter table. */
  OfxStatus sync_status = session->plugin->mainEntry(
      kOfxActionSyncPrivateData, session, NULL, NULL);
  if (sync_status != kOfxStatOK && sync_status != kOfxStatReplyDefault) {
    set_error(error, "插件 SyncPrivateData 失败（status=%d）", sync_status);
    return -1;
  }

  PropSet begin;
  memset(&begin, 0, sizeof(begin));
  ps_set_double(&begin, kOfxImageEffectPropFrameRange, 0, time);
  ps_set_double(&begin, kOfxImageEffectPropFrameRange, 1, time);
  ps_set_double(&begin, kOfxImageEffectPropFrameStep, 0, 1);
  ps_set_double(&begin, kOfxImageEffectPropRenderScale, 0, 1);
  ps_set_double(&begin, kOfxImageEffectPropRenderScale, 1, 1);
  ps_set_int(&begin, kOfxPropIsInteractive, 0, 0);
  ps_set_int(&begin, kOfxImageEffectPropRenderQualityDraft, 0, 0);
  OfxStatus status = session->plugin->mainEntry(
      kOfxImageEffectActionBeginSequenceRender, session, &begin, NULL);
  prop_set_free(&begin);
  if (status != kOfxStatOK && status != kOfxStatReplyDefault) {
    set_error(error, "BeginSequenceRender 失败（status=%d）", status);
    return -1;
  }

  PropSet render;
  memset(&render, 0, sizeof(render));
  ps_set_double(&render, kOfxPropTime, 0, time);
  ps_set_double(&render, kOfxImageEffectPropRenderScale, 0, 1);
  ps_set_double(&render, kOfxImageEffectPropRenderScale, 1, 1);
  ps_set_int(&render, kOfxImageEffectPropRenderWindow, 0, 0);
  ps_set_int(&render, kOfxImageEffectPropRenderWindow, 1, 0);
  ps_set_int(&render, kOfxImageEffectPropRenderWindow, 2, session->width);
  ps_set_int(&render, kOfxImageEffectPropRenderWindow, 3, session->height);
  ps_set_string(&render, kOfxImageEffectPropFieldToRender, 0,
                kOfxImageFieldNone);
  ps_set_int(&render, kOfxImageEffectPropSequentialRenderStatus, 0, 0);
  ps_set_int(&render, kOfxImageEffectPropInteractiveRenderStatus, 0, 0);
  ps_set_int(&render, kOfxImageEffectPropRenderQualityDraft, 0, 0);

  status = session->plugin->mainEntry(kOfxImageEffectActionRender, session,
                                      &render, NULL);
  prop_set_free(&render);

  PropSet end;
  memset(&end, 0, sizeof(end));
  ps_set_double(&end, kOfxImageEffectPropRenderScale, 0, 1);
  ps_set_double(&end, kOfxImageEffectPropRenderScale, 1, 1);
  session->plugin->mainEntry(kOfxImageEffectActionEndSequenceRender, session,
                             &end, NULL);
  prop_set_free(&end);

  if (!session->last_output_valid) {
    /* Some plugins keep the output image alive until after render returns;
     * capture the newest output slot before tearing the frame down. */
    for (int i = session->image_count - 1; i >= 0; i--) {
      if (session->images[i]->is_output) {
        capture_output(session->images[i]);
        break;
      }
    }
  }

  surface_error(session, status, error);
  int result = -1;
  if (status == kOfxStatOK || status == kOfxStatReplyDefault) {
    if (session->last_output_valid) {
      *output = session->last_output;
      session->last_output = NULL;
      session->last_output_valid = 0;
      result = 0;
    } else {
      set_error(error, "插件没有返回输出图像（status=%d）", status);
    }
  }

  session_free_images(session);
  if (session->input_native_owned) {
    free(session->input_native);
    session->input_native = NULL;
    session->input_native_owned = 0;
  }
  return result;
}

int ofx_host_render_frame(const char *bundle, const char *plugin,
                          const char *context, int width, int height,
                          double time, const float *input,
                          const OfxHostParamValue *params, int param_count,
                          float **output, char **error)
{
  OfxHostSession *session =
      ofx_host_session_open(bundle, plugin, context, width, height, error);
  if (!session) {
    return -1;
  }
  int result = ofx_host_session_render(session, time, input, params,
                                       param_count, output, error);
  ofx_host_session_close(session);
  return result;
}

/* ------------------------------------------------------------------------- */
/* Probe                                                                     */
/* ------------------------------------------------------------------------- */

static char *read_string_prop(PropSet *props, const char *key,
                              const char *fallback)
{
  char *value = NULL;
  if (props && ps_get_string(props, key, 0, &value) == kOfxStatOK && value) {
    return dup_text(value);
  }
  return dup_text(fallback ? fallback : "");
}

static int read_int_prop(PropSet *props, const char *key, int fallback)
{
  int value = fallback;
  if (props) {
    ps_get_int(props, key, 0, &value);
  }
  return value;
}

static int read_numeric(PropSet *props, const char *key, int index,
                        double *value)
{
  double number = 0;
  if (ps_get_double(props, key, index, &number) == kOfxStatOK) {
    *value = number;
    return 1;
  }
  int integer = 0;
  if (ps_get_int(props, key, index, &integer) == kOfxStatOK) {
    *value = (double)integer;
    return 1;
  }
  return 0;
}

static void read_double_array(PropSet *props, const char *key, int count,
                              double *values, int *found)
{
  int dimension = 0;
  if (!props || ps_get_dimension(props, key, &dimension) != kOfxStatOK ||
      dimension <= 0) {
    if (found) {
      *found = 0;
    }
    for (int i = 0; i < count; i++) {
      values[i] = 0;
    }
    return;
  }
  int any = 0;
  for (int i = 0; i < count; i++) {
    double value = 0;
    if (i < dimension) {
      any |= read_numeric(props, key, i, &value);
    } else if (dimension == 1) {
      any |= read_numeric(props, key, 0, &value);
    }
    values[i] = value;
  }
  if (found) {
    *found = any;
  }
}

static OfxHostParamInfo *build_param_info(Param *param)
{
  OfxHostParamInfo *info =
      (OfxHostParamInfo *)calloc(1, sizeof(OfxHostParamInfo));
  if (!info) {
    return NULL;
  }
  char *script = NULL;
  ps_get_string(&param->props, kOfxParamPropScriptName, 0, &script);
  info->name = dup_text(script ? script : param->name);
  info->label = read_string_prop(&param->props, kOfxPropLabel,
                                 info->name ? info->name : param->name);
  info->type = dup_text(param_type_label(param->type));
  info->hint = read_string_prop(&param->props, kOfxParamPropHint, "");
  info->parent = read_string_prop(&param->props, kOfxParamPropParent, "");
  info->secret = read_int_prop(&param->props, kOfxParamPropSecret, 0);
  info->enabled = read_int_prop(&param->props, kOfxParamPropEnabled, 1);
  info->dimension = param_component_count(param->type);

  if (param_is_string_type(param->type)) {
    char *value = NULL;
    ps_get_string(&param->props, kOfxParamPropDefault, 0, &value);
    info->string_default = dup_text(value ? value : "");
  } else if (param_is_double_type(param->type)) {
    read_double_array(&param->props, kOfxParamPropDefault, info->dimension,
                      info->defaults, NULL);
  } else {
    int count = info->dimension > 0 ? info->dimension : 1;
    for (int i = 0; i < count; i++) {
      int value = 0;
      ps_get_int(&param->props, kOfxParamPropDefault, i, &value);
      info->int_defaults[i] = value;
    }
  }

  int dimension = info->dimension > 0 ? info->dimension : 1;
  read_double_array(&param->props, kOfxParamPropMin, dimension, info->min,
                    &info->has_min);
  read_double_array(&param->props, kOfxParamPropMax, dimension, info->max,
                    &info->has_max);
  read_double_array(&param->props, kOfxParamPropDisplayMin, dimension,
                    info->display_min, &info->has_display_min);
  read_double_array(&param->props, kOfxParamPropDisplayMax, dimension,
                    info->display_max, &info->has_display_max);
  read_double_array(&param->props, kOfxParamPropIncrement, dimension,
                    info->increment, &info->has_increment);
  info->digits = read_int_prop(&param->props, kOfxParamPropDigits, 0);

  if (strcmp(info->type, "choice") == 0 ||
      strcmp(info->type, "strchoice") == 0) {
    const char *key = strcmp(info->type, "strchoice") == 0
                          ? kOfxParamPropChoiceEnum
                          : kOfxParamPropChoiceOption;
    int count = 0;
    ps_get_dimension(&param->props, key, &count);
    if (count <= 0 && strcmp(info->type, "strchoice") == 0) {
      key = kOfxParamPropChoiceOption;
      ps_get_dimension(&param->props, key, &count);
    }
    if (count > 0) {
      info->choices = (char **)calloc((size_t)count, sizeof(char *));
      if (info->choices) {
        for (int i = 0; i < count; i++) {
          char *option = NULL;
          ps_get_string(&param->props, key, i, &option);
          info->choices[i] = dup_text(option ? option : "");
        }
        info->choice_count = count;
      }
    }
  }
  return info;
}

static void free_param_info(OfxHostParamInfo *info)
{
  if (!info) {
    return;
  }
  free(info->name);
  free(info->label);
  free(info->type);
  free(info->hint);
  free(info->parent);
  free(info->string_default);
  if (info->choices) {
    for (int i = 0; i < info->choice_count; i++) {
      free(info->choices[i]);
    }
  }
  free(info->choices);
  memset(info, 0, sizeof(*info));
}

static void free_plugin_info(OfxHostPluginInfo *info)
{
  if (!info) {
    return;
  }
  free(info->identifier);
  free(info->name);
  free(info->label);
  free(info->grouping);
  free(info->version);
  free(info->plugin_api);
  free(info->context);
  if (info->contexts) {
    for (int i = 0; i < info->context_count; i++) {
      free(info->contexts[i]);
    }
  }
  free(info->contexts);
  if (info->pixel_depths) {
    for (int i = 0; i < info->pixel_depth_count; i++) {
      free(info->pixel_depths[i]);
    }
  }
  free(info->pixel_depths);
  if (info->clips) {
    for (int i = 0; i < info->clip_count; i++) {
      free(info->clips[i]);
    }
  }
  free(info->clips);
  if (info->params) {
    for (int i = 0; i < info->param_count; i++) {
      free_param_info(&info->params[i]);
    }
  }
  free(info->params);
  memset(info, 0, sizeof(*info));
}

void ofx_host_probe_free(OfxHostProbeResult *result)
{
  if (!result) {
    return;
  }
  if (result->plugins) {
    for (int i = 0; i < result->count; i++) {
      free_plugin_info(&result->plugins[i]);
    }
  }
  free(result->plugins);
  free(result->error);
  free(result);
}

static OfxHostProbeResult *probe_one_plugin(const char *bundle,
                                            OfxHostSession *session,
                                            OfxHostProbeResult *result,
                                            char **error)
{
  OfxPlugin *plugin = session->plugin;
  if (plugin->setHost) {
    plugin->setHost(&g_host);
  }

  OfxStatus status = plugin->mainEntry(kOfxActionLoad, NULL, NULL, NULL);
  if (status != kOfxStatOK && status != kOfxStatReplyDefault) {
    set_error(error, "插件 Load 失败（status=%d）", status);
    return result;
  }

  status = plugin->mainEntry(kOfxActionDescribe, session, NULL, NULL);
  if (status != kOfxStatOK) {
    set_error(error, "插件 Describe 失败（status=%d）", status);
    plugin->mainEntry(kOfxActionUnload, NULL, NULL, NULL);
    return result;
  }

  const char *context = pick_context(&session->desc_props, session->context);
  if (!context) {
    set_error(error, "插件没有可用的 context");
    plugin->mainEntry(kOfxActionUnload, NULL, NULL, NULL);
    return result;
  }
  if (session->context && session->context[0] &&
      !context_supported(&session->desc_props, session->context)) {
    set_error(error, "插件不支持 context：%s", session->context);
    plugin->mainEntry(kOfxActionUnload, NULL, NULL, NULL);
    return result;
  }
  free(session->context);
  session->context = dup_text(context);

  PropSet in_args;
  memset(&in_args, 0, sizeof(in_args));
  ps_set_string(&in_args, kOfxImageEffectPropContext, 0, session->context);
  status = plugin->mainEntry(kOfxImageEffectActionDescribeInContext, session,
                             &in_args, NULL);
  prop_set_free(&in_args);
  if (status != kOfxStatOK) {
    set_error(error, "插件 DescribeInContext 失败（status=%d）", status);
    plugin->mainEntry(kOfxActionUnload, NULL, NULL, NULL);
    return result;
  }

  OfxHostPluginInfo *info =
      (OfxHostPluginInfo *)realloc(result->plugins,
                                   (size_t)(result->count + 1) * sizeof(*info));
  if (!info) {
    set_error(error, "内存不足");
    plugin->mainEntry(kOfxActionUnload, NULL, NULL, NULL);
    return result;
  }
  result->plugins = info;
  OfxHostPluginInfo *entry = &result->plugins[result->count++];
  memset(entry, 0, sizeof(*entry));

  entry->identifier = dup_text(plugin->pluginIdentifier ? plugin->pluginIdentifier : "");
  entry->plugin_api = dup_text(plugin->pluginApi ? plugin->pluginApi : "");
  entry->api_version = plugin->apiVersion;
  entry->version_major = plugin->pluginVersionMajor;
  entry->version_minor = plugin->pluginVersionMinor;
  entry->version = (char *)malloc(64);
  if (entry->version) {
    snprintf(entry->version, 64, "%u.%u", plugin->pluginVersionMajor,
             plugin->pluginVersionMinor);
  }
  entry->label = read_string_prop(&session->desc_props, kOfxPropLabel,
                                  entry->identifier);
  entry->name = dup_text(entry->label);
  entry->grouping =
      read_string_prop(&session->desc_props, kOfxImageEffectPluginPropGrouping, "");
  entry->context = dup_text(session->context);

  int context_count = 0;
  ps_get_dimension(&session->desc_props, kOfxImageEffectPropSupportedContexts,
                   &context_count);
  if (context_count > 0) {
    entry->contexts = (char **)calloc((size_t)context_count, sizeof(char *));
    for (int i = 0; i < context_count; i++) {
      char *value = NULL;
      ps_get_string(&session->desc_props, kOfxImageEffectPropSupportedContexts,
                    i, &value);
      entry->contexts[i] = dup_text(value ? value : "");
    }
    entry->context_count = context_count;
  }

  int depth_count = 0;
  ps_get_dimension(&session->desc_props, kOfxImageEffectPropSupportedPixelDepths,
                   &depth_count);
  if (depth_count > 0) {
    entry->pixel_depths = (char **)calloc((size_t)depth_count, sizeof(char *));
    for (int i = 0; i < depth_count; i++) {
      char *value = NULL;
      ps_get_string(&session->desc_props, kOfxImageEffectPropSupportedPixelDepths,
                    i, &value);
      entry->pixel_depths[i] = dup_text(value ? value : "");
    }
    entry->pixel_depth_count = depth_count;
  }

  if (session->clip_count > 0) {
    entry->clips = (char **)calloc((size_t)session->clip_count, sizeof(char *));
    for (int i = 0; i < session->clip_count; i++) {
      entry->clips[i] = dup_text(session->clips[i].name);
    }
    entry->clip_count = session->clip_count;
  }

  if (session->param_count > 0) {
    entry->params =
        (OfxHostParamInfo *)calloc((size_t)session->param_count,
                                   sizeof(OfxHostParamInfo));
    for (int i = 0; i < session->param_count; i++) {
      OfxHostParamInfo *built = build_param_info(&session->params[i]);
      if (built) {
        entry->params[entry->param_count++] = *built;
        free(built);
      }
    }
  }

  plugin->mainEntry(kOfxActionUnload, NULL, NULL, NULL);
  (void)bundle;
  return result;
}

OfxHostProbeResult *ofx_host_probe(const char *bundle, const char *plugin_id,
                                   const char *context)
{
  init_host();
  OfxHostProbeResult *result =
      (OfxHostProbeResult *)calloc(1, sizeof(OfxHostProbeResult));
  if (!result) {
    return NULL;
  }

  char *binary = resolve_bundle(
      bundle, &result->error);
  if (!binary) {
    return result;
  }

  OfxLibHandle lib = OFX_LIB_OPEN(binary);
  if (!lib) {
#ifdef _WIN32
    set_load_error(&result->error, binary, NULL);
#else
    set_load_error(&result->error, binary, dlerror());
#endif
    free(binary);
    return result;
  }
  free(binary);

  OfxGetNumberOfPluginsFn get_count =
      (OfxGetNumberOfPluginsFn)OFX_LIB_SYM(lib, "OfxGetNumberOfPlugins");
  OfxGetPluginFn get_plugin =
      (OfxGetPluginFn)OFX_LIB_SYM(lib, "OfxGetPlugin");
  if (!get_count || !get_plugin) {
    set_error(&result->error,
              "不是 OFX 插件（缺少 OfxGetNumberOfPlugins/OfxGetPlugin）");
    OFX_LIB_CLOSE(lib);
    return result;
  }

  int count = get_count();
  char *first_error = NULL;
  for (int i = 0; i < count; i++) {
    OfxPlugin *plugin = get_plugin(i);
    if (!plugin) {
      continue;
    }
    if (plugin_id && plugin_id[0]) {
      if (!plugin->pluginIdentifier ||
          strcmp(plugin->pluginIdentifier, plugin_id) != 0) {
        continue;
      }
    }
    OfxHostSession *session =
        (OfxHostSession *)calloc(1, sizeof(OfxHostSession));
    if (!session) {
      set_error(&result->error, "内存不足");
      break;
    }
    session->lib = lib;
    session->plugin = plugin;
    session->width = 1920;
    session->height = 1080;
    session->context = context ? dup_text(context) : NULL;
    session->phase = 0;
    g_session = session;
    char *plugin_error = NULL;
    probe_one_plugin(bundle, session, result, &plugin_error);
    g_session = NULL;
    for (int p = 0; p < session->param_count; p++) {
      param_free(&session->params[p]);
    }
    free(session->params);
    for (int c = 0; c < session->clip_count; c++) {
      clip_free(&session->clips[c]);
    }
    free(session->clips);
    prop_set_free(&session->desc_props);
    prop_set_free(&session->inst_props);
    free(session->context);
    free(session);
    if (plugin_error) {
      /* One unsupported effect in a multi-plugin bundle must not hide the
       * effects that do work; keep the first message for the all-failed case. */
      if (!first_error) {
        first_error = plugin_error;
      } else {
        free(plugin_error);
      }
    }
  }

  if (result->count == 0 && first_error) {
    result->error = first_error;
    first_error = NULL;
  }
  free(first_error);
  OFX_LIB_CLOSE(lib);
  return result;
}
