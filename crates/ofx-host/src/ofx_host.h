#ifndef AICUT_OFX_HOST_H
#define AICUT_OFX_HOST_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* A parameter as reported by kOfxActionDescribeInContext. */
typedef struct OfxHostParamInfo {
  char *name;
  char *label;
  char *type;      /* double | integer | boolean | choice | strchoice | rgb | rgba | string | custom | group | page | pushbutton */
  char *hint;
  char *parent;
  int secret;
  int enabled;
  int dimension;   /* 1, 2, 3 or 4 */
  double defaults[4];
  int int_defaults[4];
  char *string_default;
  int has_min;
  int has_max;
  int has_display_min;
  int has_display_max;
  int has_increment;
  double min[4];
  double max[4];
  double display_min[4];
  double display_max[4];
  double increment[4];
  int digits;
  int choice_count;
  char **choices;
} OfxHostParamInfo;

typedef struct OfxHostPluginInfo {
  char *identifier;
  char *name;
  char *label;
  char *grouping;
  char *version;
  char *plugin_api;
  int api_version;
  unsigned int version_major;
  unsigned int version_minor;
  char *context;        /* context used for the parameter table */
  char **contexts;
  int context_count;
  char **pixel_depths;
  int pixel_depth_count;
  char **clips;
  int clip_count;
  OfxHostParamInfo *params;
  int param_count;
} OfxHostPluginInfo;

typedef struct OfxHostProbeResult {
  OfxHostPluginInfo *plugins;
  int count;
  char *error;
} OfxHostProbeResult;

/* A parameter value supplied to a render.  Only the field matching the
 * parameter type is read, so callers may populate all of them. */
typedef struct OfxHostParamValue {
  const char *name;
  double d[4];
  int i;
  const char *s;
} OfxHostParamValue;

/* Probe every plugin in a bundle.  `plugin_id` may be NULL to include all
 * plugins; `context` may be NULL to pick the best supported context. */
OfxHostProbeResult *ofx_host_probe(const char *bundle,
                                   const char *plugin_id,
                                   const char *context);
void ofx_host_probe_free(OfxHostProbeResult *result);

/* A reusable plugin instance.  Opening a session loads the bundle, describes
 * the plugin, creates an instance and keeps it alive for many frames. */
typedef struct OfxHostSession OfxHostSession;

OfxHostSession *ofx_host_session_open(const char *bundle,
                                      const char *plugin,
                                      const char *context,
                                      int width,
                                      int height,
                                      char **error);
/* Render one RGBA float frame.  `*output` is allocated with malloc and must be
 * freed with ofx_host_free. */
int ofx_host_session_render(OfxHostSession *session,
                            double time,
                            const float *input,
                            const OfxHostParamValue *params,
                            int param_count,
                            float **output,
                            char **error);
void ofx_host_session_close(OfxHostSession *session);

/* One-shot convenience wrapper. */
int ofx_host_render_frame(const char *bundle,
                          const char *plugin,
                          const char *context,
                          int width,
                          int height,
                          double time,
                          const float *input,
                          const OfxHostParamValue *params,
                          int param_count,
                          float **output,
                          char **error);

void ofx_host_free(void *pointer);
const char *ofx_host_version(void);

#ifdef __cplusplus
}
#endif

#endif
