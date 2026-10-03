{{- define "iq.fullname" -}}
{{- if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "iq.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "iq.selector" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/* Secret holding REDIS_CONNECTION_STRING (and the valkey password) */}}
{{- define "iq.secretName" -}}
{{- .Values.externalRedis.existingSecret | default (include "iq.fullname" .) -}}
{{- end -}}

{{/* Valkey password: explicit value, else the one already in the cluster, else a new random one */}}
{{- define "iq.valkeyPassword" -}}
{{- $existing := lookup "v1" "Secret" .Release.Namespace (include "iq.fullname" .) -}}
{{- if .Values.valkey.password -}}
{{- .Values.valkey.password -}}
{{- else if and $existing (index $existing.data "VALKEY_PASSWORD") -}}
{{- index $existing.data "VALKEY_PASSWORD" | b64dec -}}
{{- else -}}
{{- randAlphaNum 32 -}}
{{- end -}}
{{- end -}}
