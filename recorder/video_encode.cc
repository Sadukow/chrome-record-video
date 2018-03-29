// Copyright 2015 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
// ffmpeg -i capture.webm -i capture.wav -fflags +genpts -c:v libx264 -c:a aac -shortest -y output.mp4

#include <math.h>
#include <stdio.h>
#include <string.h>

#include <algorithm>
#include <deque>
#include <iostream>
#include <map>
#include <sstream>
#include <vector>

#include "ppapi/c/pp_errors.h"
#include "ppapi/c/ppb_console.h"
#include "ppapi/cpp/input_event.h"
#include "ppapi/cpp/instance.h"
#include "ppapi/c/ppb_file_io.h"
#include "ppapi/cpp/file_io.h"
#include "ppapi/cpp/file_ref.h"
#include "ppapi/cpp/file_system.h"
#include "ppapi/cpp/media_stream_video_track.h"
#include "ppapi/cpp/media_stream_audio_track.h"
#include "ppapi/cpp/module.h"
#include "ppapi/cpp/rect.h"
#include "ppapi/cpp/var.h"
#include "ppapi/cpp/var_array_buffer.h"
#include "ppapi/cpp/var_dictionary.h"
#include "ppapi/cpp/video_encoder.h"
#include "ppapi/cpp/video_frame.h"
#include "ppapi/cpp/audio_buffer.h"
#include "ppapi/cpp/audio_encoder.h"
#include "ppapi/utility/threading/simple_thread.h"
#include "ppapi/utility/completion_callback_factory.h"

// When compiling natively on Windows, PostMessage, min and max can be
// #define-d to something else.
#ifdef WIN32
#undef min
#undef max
#undef PostMessage
#endif

// Use assert as a poor-man's CHECK, even in non-debug mode.
// Since <assert.h> redefines assert on every inclusion (it doesn't use
// include-guards), make sure this is the last file #include'd in this file.
#undef NDEBUG
#include <assert.h>

#define fourcc(a, b, c, d)  (((uint32_t)(a) << 0) | ((uint32_t)(b) << 8) | ((uint32_t)(c) << 16) | ((uint32_t)(d) << 24))

namespace {

double clamp(double min, double max, double value) {
  return std::max(std::min(value, max), min);
}

std::string ToUpperString(const std::string& str) {
  std::string ret;
  for (uint32_t i = 0; i < str.size(); i++)
    ret.push_back(static_cast<char>(toupper(str[i])));
  return ret;
}

// ==========================================================================================
// IVF контейнер записи. Можно разобрать H264 битового потока с использованием единицы NAL,
// но для VP8 нам нужен контейнер, по крайней мере, найти кодированный изображения, а также размеры изображения.
class IVFWriter {
 public:
  IVFWriter() {}
  ~IVFWriter() {}

  uint32_t GetFileHeaderSize() const { return 32; }
  uint32_t GetFrameHeaderSize() const { return 12; }
  uint32_t WriteFileHeader(uint8_t* mem,
                           const std::string& codec,
                           int32_t width,
                           int32_t height);
  uint32_t WriteFrameHeader(uint8_t* mem, uint64_t pts, size_t frame_size);
  
  uint32_t GetWavHeaderSize() const { return 44; }
  uint32_t WriteWavHeader( uint8_t* mem,
						   uint32_t channels,
						   uint32_t sample_rate,
						   uint32_t sample_size,
						   uint32_t sample_per_frame );
  uint32_t WriteWavGetSize( uint8_t* mem, uint32_t size );
  

 private:
  void PutLE16(uint8_t* mem, int val) const {
    mem[0] = (val >> 0) & 0xff;
    mem[1] = (val >> 8) & 0xff;
  }
  void PutLE32(uint8_t* mem, int val) const {
    mem[0] = (val >> 0) & 0xff;
    mem[1] = (val >> 8) & 0xff;
    mem[2] = (val >> 16) & 0xff;
    mem[3] = (val >> 24) & 0xff;
  }
};

uint32_t IVFWriter::WriteFileHeader(uint8_t* mem,
                                    const std::string& codec,
                                    int32_t width,
                                    int32_t height) {
  mem[0] = 'D';
  mem[1] = 'K';
  mem[2] = 'I';
  mem[3] = 'F';
  PutLE16(mem + 4, 0);                                          // version
  PutLE16(mem + 6, 32);                                         // header size
  PutLE32(mem + 8, fourcc(codec[0], codec[1], codec[2], '0'));  // fourcc
  PutLE16(mem + 12, static_cast<uint16_t>(width));              // width
  PutLE16(mem + 14, static_cast<uint16_t>(height));             // height
  PutLE32(mem + 16, 1000);                                      // rate
  PutLE32(mem + 20, 1);                                         // scale
  PutLE32(mem + 24, 0xffffffff);                                // length
  PutLE32(mem + 28, 0);                                         // unused

  return 32;
}

uint32_t IVFWriter::WriteFrameHeader(uint8_t* mem,
                                     uint64_t pts,
                                     size_t frame_size) {
  PutLE32(mem, (int)frame_size);
  PutLE32(mem + 4, (int)(pts & 0xFFFFFFFF));
  PutLE32(mem + 8, (int)(pts >> 32));

  return 12;
}

uint32_t IVFWriter::WriteWavHeader( uint8_t* mem,
									uint32_t channels,
									uint32_t sample_rate,
									uint32_t sample_size,
									uint32_t sample_per_frame  ) {
  mem[0] = 'R';
  mem[1] = 'I';
  mem[2] = 'F';
  mem[3] = 'F';
  // 4 - Gap for final size. 
  mem[4] = 0;
  mem[5] = 0x7A;
  mem[6] = 0;
  mem[7] = 0;
  mem[8]  = 'W';
  mem[9]  = 'A';
  mem[10] = 'V';
  mem[11] = 'E';
  // Chunk ID.
  mem[12] = 'f';
  mem[13] = 'm';
  mem[14] = 't';
  mem[15] = ' ';
  // Chunk length.
  PutLE32(mem + 16, 16);  
  // Codec (uncompressed LPCM).
  PutLE16(mem + 20, 1); 
  // Number of channels.
  PutLE16(mem + 22, channels); 
  // Sample rate.
  PutLE32(mem + 24, sample_rate); 
  // Average bytes per seconds (sample rate * bytes per sample) 
  PutLE32(mem + 28, sample_rate * sample_size); 
  // Bytes per sample.
  PutLE16(mem + 32, sample_size * channels); 
  // Bits per sample.
  PutLE16(mem + 34, sample_size * 8); 
  
  // Data chunk
  mem[36] = 'd';
  mem[37] = 'a';
  mem[38] = 't';
  mem[39] = 'a';

  return 44;
}  

uint32_t IVFWriter::WriteWavGetSize( uint8_t* mem, uint32_t size ) {
	
  PutLE32(mem, size);

  return 4;
}  


// ==========================================================================================
// Этот объект является глобальным объектом, представляющим эту библиотеку плагинов, если он загружен.
class VideoEncoderModule : public pp::Module {
 public:
  VideoEncoderModule() : pp::Module() {}
  virtual ~VideoEncoderModule() {}

  virtual pp::Instance* CreateInstance(PP_Instance instance);
};

class VideoEncoderInstance : public pp::Instance {
 public:
  VideoEncoderInstance(PP_Instance instance, pp::Module* module);
  virtual ~VideoEncoderInstance();

  // pp::Instance implementation.
  virtual void HandleMessage(const pp::Var& var_message);

  virtual bool Init(uint32_t /*argc*/, const char * /*argn*/ [], const char * /*argv*/ []);
  
  pp::FileSystem file_system_;
  bool file_system_ready_;
  
  // Мы делаем все наши файловые операции на file_thread_.
  pp::SimpleThread file_thread_;
  

 private:

  int64_t offset_video;
  int64_t offset_audio;
  int64_t offset_camera;
 
  void OpenFileSystem(int32_t /* result */);
  void CloseFileSystem(int32_t /* result */);
  void OpenFile(pp::FileIO * file, std::string filename);
  void CloseFile(pp::FileIO * file);
  void SaveFile(pp::FileIO * file, const char * file_contents, uint32_t size, int64_t * offset_file);
  void SaveVideo(int32_t /* result */, const char * file_contents, uint32_t size);
  void SaveAudio(int32_t /* result */, const char * file_contents, uint32_t size);
  void SaveCamera(int32_t /* result */, const char * file_contents, uint32_t size);
 
  void ConfigureTrack();
  void OnConfiguredTrack(int32_t result);
  void StartEncoder();
  void OnInitializedEncoder(int32_t result);
  void ScheduleNextEncode();
  void GetEncoderFrameTick(int32_t result);
  void GetEncoderFrame(const pp::VideoFrame& track_frame);
  void OnEncoderFrame(int32_t result, pp::VideoFrame encoder_frame, pp::VideoFrame track_frame);
  int32_t CopyVideoFrame(pp::VideoFrame dest, pp::VideoFrame src);
  void EncodeFrame(const pp::VideoFrame& frame);
  void OnEncodeDoneVideo(int32_t result);
  void OnGetBitstreamBufferVideo(int32_t result, PP_BitstreamBuffer buffer);
  void StartTrackFrames();
  void StopTrackFrames();
  void OnTrackFrame(int32_t result, pp::VideoFrame frame);

  /*void ProbeEncoder();
  void OnEncoderProbed(int32_t result, const std::vector<PP_VideoProfileDescription> profiles);  
  void AddVideoProfile(PP_VideoProfile profile, const std::string& profile_str);
  void InitializeVideoProfiles();
  PP_VideoProfile VideoProfileFromString(const std::string& str);
  std::string VideoProfileToString(PP_VideoProfile profile);
  typedef std::map<std::string, PP_VideoProfile> VideoProfileFromStringMap;
  VideoProfileFromStringMap profile_from_string_;
  typedef std::map<PP_VideoProfile, std::string> VideoProfileToStringMap;
  VideoProfileToStringMap profile_to_string_;*/



  void StopEncode();

  void LogError(int32_t error, const std::string& message);
  void Log(const std::string& message);

  void PostDataMessage(const void* buffer, uint32_t size);
  void WriteVideoData(const void* buffer, uint32_t size);
  void WriteAudioData(const void* buffer, uint32_t size);

  bool is_encoding_;
  bool is_encode_ticking_;
  bool is_receiving_track_frames_;

  pp::VideoEncoder video_encoder_;
  pp::AudioEncoder audio_encoder_;
  pp::CompletionCallbackFactory<VideoEncoderInstance> callback_factory_;

  PP_VideoProfile video_profile_;
  PP_VideoFrame_Format frame_format_;

  pp::Size requested_size_;
  pp::Size frame_size_;
  pp::Size encoder_size_;
  uint32_t encoded_frames_;
  
  uint32_t channels_;
  uint32_t sample_rate_;
  uint32_t sample_size_;
  uint32_t samples_per_frame_;

  std::deque<uint64_t> frames_timestamps_;

  pp::VideoFrame current_track_frame_;

  IVFWriter ivf_writer_;

  PP_Time last_encode_tick_;
  
  void OnGetBufferAudio(int32_t result, pp::AudioBuffer buffer);
  void StopAudioTrack();

  //------------- данные по стримам
  bool is_video_;
  bool is_audio_;
  bool is_camera_;
  
  pp::MediaStreamVideoTrack video_track_;
  pp::MediaStreamAudioTrack audio_track_;
  pp::MediaStreamAudioTrack camera_track_;
  
  
  //------------- данные по файлам	
  pp::FileIO fileVideo;
  pp::FileIO fileAudio;
  pp::FileIO fileCamera;
  
  std::string videoFileName;
  std::string audioFileName;
  std::string cameraFileName;
  
  
  std::string videoFile;
  std::string audioFile;
  
};

// --------------------------------------------------------------------------
VideoEncoderInstance::VideoEncoderInstance(PP_Instance instance,  pp::Module* module)
								  : pp::Instance(instance),
									file_system_(this, PP_FILESYSTEMTYPE_LOCALPERSISTENT),
									file_system_ready_(false),
									file_thread_(this),
									offset_video(0),
									offset_audio(0),
                  offset_camera(0),
									is_encoding_(false),
									is_encode_ticking_(false),
									callback_factory_(this),
									video_profile_(PP_VIDEOPROFILE_VP8_ANY),
									frame_format_(PP_VIDEOFRAME_FORMAT_I420),
									encoded_frames_(0),
									channels_(0),
									sample_rate_(0),
									sample_size_(0),
									samples_per_frame_(0),
									last_encode_tick_(0), 

									is_video_(false),
									is_audio_(false),
									is_camera_(false),

									fileVideo(this),
									fileAudio(this),
									fileCamera(this)
{
  //InitializeVideoProfiles();
  //ProbeEncoder();
}

// --------------------------------------------------------------------------
VideoEncoderInstance::~VideoEncoderInstance() {
}
// --------------------------------------------------------------------------
/*void VideoEncoderInstance::ProbeEncoder() {

  video_encoder_ = pp::VideoEncoder(this);
  video_encoder_.GetSupportedProfiles(callback_factory_.NewCallbackWithOutput( &VideoEncoderInstance::OnEncoderProbed ) );
}
// --------------------------------------------------------------------------
void VideoEncoderInstance::OnEncoderProbed( int32_t result, const std::vector<PP_VideoProfileDescription> profiles) {

  pp::VarDictionary dict;
  dict.Set(pp::Var("name"), pp::Var("supportedProfiles"));
  pp::VarArray js_profiles;
  dict.Set(pp::Var("value"), js_profiles);

  if (result < 0) {
    LogError(result, "Cannot get supported profiles");
    PostMessage(dict);
  }

  int32_t idx = 0;
  for (uint32_t i = 0; i < profiles.size(); i++) {
    const PP_VideoProfileDescription& profile = profiles[i];
    js_profiles.Set(idx++, pp::Var(VideoProfileToString(profile.profile)));
  }  
  PostMessage(dict);
}
// --------------------------------------------------------------------------
void VideoEncoderInstance::AddVideoProfile(PP_VideoProfile profile, const std::string& profile_str) {
  profile_to_string_.insert(std::make_pair(profile, profile_str));
  profile_from_string_.insert(std::make_pair(profile_str, profile));
}
// --------------------------------------------------------------------------
void VideoEncoderInstance::InitializeVideoProfiles() {
  AddVideoProfile(PP_VIDEOPROFILE_H264BASELINE, "h264baseline");
  AddVideoProfile(PP_VIDEOPROFILE_H264MAIN, "h264main");
  AddVideoProfile(PP_VIDEOPROFILE_H264EXTENDED, "h264extended");
  AddVideoProfile(PP_VIDEOPROFILE_H264HIGH, "h264high");
  AddVideoProfile(PP_VIDEOPROFILE_H264HIGH10PROFILE, "h264high10");
  AddVideoProfile(PP_VIDEOPROFILE_H264HIGH422PROFILE, "h264high422");
  AddVideoProfile(PP_VIDEOPROFILE_H264HIGH444PREDICTIVEPROFILE, "h264high444predictive");
  AddVideoProfile(PP_VIDEOPROFILE_H264SCALABLEBASELINE, "h264scalablebaseline");
  AddVideoProfile(PP_VIDEOPROFILE_H264SCALABLEHIGH, "h264scalablehigh");
  AddVideoProfile(PP_VIDEOPROFILE_H264STEREOHIGH, "h264stereohigh");
  AddVideoProfile(PP_VIDEOPROFILE_H264MULTIVIEWHIGH, "h264multiviewhigh");
  AddVideoProfile(PP_VIDEOPROFILE_VP8_ANY, "vp8");
  AddVideoProfile(PP_VIDEOPROFILE_VP9_ANY, "vp9");
}
// --------------------------------------------------------------------------
PP_VideoProfile VideoEncoderInstance::VideoProfileFromString(const std::string& str) {
  VideoProfileFromStringMap::iterator it = profile_from_string_.find(str);
  if (it == profile_from_string_.end())  return PP_VIDEOPROFILE_VP8_ANY;
  return it->second;
}
// --------------------------------------------------------------------------
std::string VideoEncoderInstance::VideoProfileToString( PP_VideoProfile profile ) {
  VideoProfileToStringMap::iterator it = profile_to_string_.find(profile);
  if (it == profile_to_string_.end())   return "unknown";
  return it->second;
}*/


// ===========================================================================
//   инициализация и конфигурирование
// --------------------------------------------------------------------------
bool VideoEncoderInstance::Init( uint32_t argc, const char *argn[], const char *argv[] ) {
	
  file_thread_.Start();

  return true;
}

// --------------------------------------------------------------------------
void VideoEncoderInstance::ConfigureTrack() {

  if (encoder_size_.IsEmpty())    frame_size_ = requested_size_;
  else                            frame_size_ = encoder_size_;

  int32_t attrib_list[] = {PP_MEDIASTREAMVIDEOTRACK_ATTRIB_FORMAT,
                           frame_format_,
                           PP_MEDIASTREAMVIDEOTRACK_ATTRIB_WIDTH,
                           frame_size_.width(),
                           PP_MEDIASTREAMVIDEOTRACK_ATTRIB_HEIGHT,
                           frame_size_.height(),
                           PP_MEDIASTREAMVIDEOTRACK_ATTRIB_NONE};

  if (is_video_)  video_track_.Configure( attrib_list, callback_factory_.NewCallback(&VideoEncoderInstance::OnConfiguredTrack));
	  
  if (is_audio_)  audio_track_.GetBuffer(callback_factory_.NewCallbackWithOutput( &VideoEncoderInstance::OnGetBufferAudio));
	  
}
// --------------------------------------------------------------------------
void VideoEncoderInstance::OnConfiguredTrack(int32_t result) {

  if (result != PP_OK) {
    LogError(result, "Cannot configure track");
    return;
  }

  if (is_encoding_) {
    StartTrackFrames();
    ScheduleNextEncode();
  } 
  else {
    StartEncoder();
  }
}
// --------------------------------------------------------------------------
void VideoEncoderInstance::OnGetBufferAudio(int32_t result, pp::AudioBuffer buffer) {
  
  if (result == PP_ERROR_ABORTED)   return;
  if (result != PP_OK) {
    LogError(result, "Cannot get audio track buffer");
    return;
  }
  
  //char b[100];  
  //sprintf(b, "channels:  (%d) ", channels_);
  //Log(b);
  
  // Если это первый буфер, то нам необходимо инициализировать кодер.
  if (channels_ == 0) {
    channels_ = buffer.GetNumberOfChannels();
    sample_rate_ = buffer.GetSampleRate();
    sample_size_ = buffer.GetSampleSize();
    samples_per_frame_ = buffer.GetNumberOfSamples();
  
    uint32_t frame_offset = 0;
  
    uint8_t* arrayHeader = (uint8_t*) malloc(ivf_writer_.GetWavHeaderSize());

    frame_offset = ivf_writer_.WriteWavHeader( arrayHeader,
                         channels_,
                         sample_rate_,    
                         sample_size_,
                         samples_per_frame_ );  

    file_thread_.message_loop().PostWork(callback_factory_.NewCallback(&VideoEncoderInstance::SaveAudio, (char *)arrayHeader, frame_offset));                     

    file_thread_.message_loop().PostWork(callback_factory_.NewCallback(&VideoEncoderInstance::SaveAudio, (char *)buffer.GetDataBuffer(), buffer.GetDataBufferSize()));
  
    audio_track_.GetBuffer(callback_factory_.NewCallbackWithOutput( &VideoEncoderInstance::OnGetBufferAudio));

    // Учитывая, что когда-кодер инициализируется мы могли бы изменить конфигурацию трека средств массовой информации,
    // отбросить первый буфер, чтобы сохранить этот пример немного проще. 
    audio_track_.RecycleBuffer(buffer);
  } 
  else {
    file_thread_.message_loop().PostWork(callback_factory_.NewCallback(&VideoEncoderInstance::SaveAudio, (char *)buffer.GetDataBuffer(), buffer.GetDataBufferSize()));  
    
    audio_track_.RecycleBuffer(buffer);

    audio_track_.GetBuffer(callback_factory_.NewCallbackWithOutput( &VideoEncoderInstance::OnGetBufferAudio));
  }
}

// ===========================================================================
//  Track Frames
// --------------------------------------------------------------------------
void VideoEncoderInstance::StartTrackFrames() {
  is_receiving_track_frames_ = true;
  video_track_.GetFrame( callback_factory_.NewCallbackWithOutput( &VideoEncoderInstance::OnTrackFrame ) );
}

// --------------------------------------------------------------------------
void VideoEncoderInstance::StopTrackFrames() {
  is_receiving_track_frames_ = false;
  if (!current_track_frame_.is_null()) {
    video_track_.RecycleFrame(current_track_frame_);
    current_track_frame_.detach();
  }
}

// --------------------------------------------------------------------------
void VideoEncoderInstance::OnTrackFrame(int32_t result, pp::VideoFrame frame) {

  if (result == PP_ERROR_ABORTED)    return;

  if (!current_track_frame_.is_null()) {
    video_track_.RecycleFrame(current_track_frame_);
    current_track_frame_.detach();
  }

  if (result != PP_OK) {
    LogError(result, "Cannot get video frame from video track");
    return;
  }

  current_track_frame_ = frame;
  if (is_receiving_track_frames_)  video_track_.GetFrame(callback_factory_.NewCallbackWithOutput( &VideoEncoderInstance::OnTrackFrame));
}



// ===========================================================================
//   Encode
// --------------------------------------------------------------------------
void VideoEncoderInstance::StartEncoder() {

  //LogToConsole(PP_LOGLEVEL_ERROR, pp::Var("StartEncoder - "));

  video_encoder_ = pp::VideoEncoder(this);
  frames_timestamps_.clear();

  int32_t error = video_encoder_.Initialize(
                            frame_format_,                          //  PP_VideoFrame_Формат кадров, которые будут закодированы
                            frame_size_,                            //  Размер, определяющий размеры видимой части входных кадров.
                            video_profile_,                         //  PP_VideoProfile указывая профиль кодека кодированного выходного потока.
                            2000000,                          
                            PP_HARDWAREACCELERATION_WITHFALLBACK,   //  PP_HardwareAcceleration спецификация определяющая, следует ли использовать аппаратное ускорение или реализацию программного обеспечения.
                            callback_factory_.NewCallback( &VideoEncoderInstance::OnInitializedEncoder) );

  if (error != PP_OK_COMPLETIONPENDING) {
    LogError(error, "Cannot initialize encoder");
    return;
  }
}

// --------------------------------------------------------------------------
void VideoEncoderInstance::OnInitializedEncoder(int32_t result) {

  if (result != PP_OK) {
    LogError(result, "Encoder initialization failed");
    return;
  }

  is_encoding_ = true;
  Log("started encoding");

  if (video_encoder_.GetFrameCodedSize(&encoder_size_) != PP_OK) {
    LogError(result, "Cannot get encoder coded frame size");
    return;
  }

  video_encoder_.GetBitstreamBuffer(callback_factory_.NewCallbackWithOutput(&VideoEncoderInstance::OnGetBitstreamBufferVideo));

  if (encoder_size_ != frame_size_)
    ConfigureTrack();
  else {
    StartTrackFrames();
    ScheduleNextEncode();
  }
}

// --------------------------------------------------------------------------
void VideoEncoderInstance::OnGetBitstreamBufferVideo(int32_t result, PP_BitstreamBuffer buffer) {

  if (result == PP_ERROR_ABORTED)  return;
  if (result != PP_OK) {
    LogError(result, "Cannot get bitstream buffer");
    return;
  }
  
  encoded_frames_++;
  WriteVideoData(buffer.buffer, buffer.size);
  video_encoder_.RecycleBitstreamBuffer(buffer);

  video_encoder_.GetBitstreamBuffer(callback_factory_.NewCallbackWithOutput(&VideoEncoderInstance::OnGetBitstreamBufferVideo));
}

// --------------------------------------------------------------------------
void VideoEncoderInstance::ScheduleNextEncode() {
  // Avoid scheduling more than once at a time.
  if (is_encode_ticking_)
    return;

  PP_Time now = pp::Module::Get()->core()->GetTime();
  PP_Time tick = 1.0 / 30;
  // If the callback was triggered late, we need to account for that delay for the next tick.
  PP_Time delta = tick - clamp(0, tick, now - last_encode_tick_ - tick);

  pp::Module::Get()->core()->CallOnMainThread(
                                    delta * 1000,
                                    callback_factory_.NewCallback(&VideoEncoderInstance::GetEncoderFrameTick),
                                    0);

  last_encode_tick_ = now;
  is_encode_ticking_ = true;
}
// --------------------------------------------------------------------------
void VideoEncoderInstance::GetEncoderFrameTick(int32_t result) {
  is_encode_ticking_ = false;

  if (is_encoding_) {
    if (!current_track_frame_.is_null()) {
      pp::VideoFrame frame = current_track_frame_;
      current_track_frame_.detach();
      GetEncoderFrame(frame);
    }
    ScheduleNextEncode();
  }
}

// --------------------------------------------------------------------------
void VideoEncoderInstance::GetEncoderFrame(const pp::VideoFrame& track_frame) {

  video_encoder_.GetVideoFrame(callback_factory_.NewCallbackWithOutput( &VideoEncoderInstance::OnEncoderFrame, track_frame ) );

}
// --------------------------------------------------------------------------
void VideoEncoderInstance::OnEncoderFrame(int32_t result,
                                          pp::VideoFrame encoder_frame,
                                          pp::VideoFrame track_frame) {
  if (result == PP_ERROR_ABORTED) {
    video_track_.RecycleFrame(track_frame);
    return;
  }
  if (result != PP_OK) {
    video_track_.RecycleFrame(track_frame);
    LogError(result, "Cannot get video frame from video encoder");
    return;
  }

  track_frame.GetSize(&frame_size_);

  if (frame_size_ != encoder_size_) {
    video_track_.RecycleFrame(track_frame);
    LogError(PP_ERROR_FAILED, "MediaStreamVideoTrack frame size incorrect");
    return;
  }

  if (CopyVideoFrame(encoder_frame, track_frame) == PP_OK)    EncodeFrame(encoder_frame);
  video_track_.RecycleFrame(track_frame);
}

// --------------------------------------------------------------------------
int32_t VideoEncoderInstance::CopyVideoFrame(pp::VideoFrame dest, pp::VideoFrame src) {

  if (dest.GetDataBufferSize() < src.GetDataBufferSize()) {
    std::ostringstream oss;
    oss << "Incorrect destination video frame buffer size : " << dest.GetDataBufferSize() << " < " << src.GetDataBufferSize();
    LogError(PP_ERROR_FAILED, oss.str());
    return PP_ERROR_FAILED;
  }

  dest.SetTimestamp(src.GetTimestamp());
  memcpy(dest.GetDataBuffer(), src.GetDataBuffer(), src.GetDataBufferSize());
  return PP_OK;
}

// --------------------------------------------------------------------------
void VideoEncoderInstance::EncodeFrame(const pp::VideoFrame& frame) {
  frames_timestamps_.push_back(
      static_cast<uint64_t>(frame.GetTimestamp() * 1000));
  video_encoder_.Encode(
      frame, PP_FALSE,
      callback_factory_.NewCallback(&VideoEncoderInstance::OnEncodeDoneVideo));
}

// --------------------------------------------------------------------------
void VideoEncoderInstance::OnEncodeDoneVideo(int32_t result) {
  if (result == PP_ERROR_ABORTED)
    return;
  if (result != PP_OK)
    LogError(result, "Encode failed");
}

// --------------------------------------------------------------------------
void VideoEncoderInstance::StopEncode() {
  video_encoder_.Close();
  StopTrackFrames();
  video_track_.Close();
  is_encoding_ = false;
  encoded_frames_ = 0;
}



// ===========================================================================
//  Audio
// --------------------------------------------------------------------------
void VideoEncoderInstance::StopAudioTrack() {
  channels_ = 0;
  audio_track_.Close();
  audio_track_ = pp::MediaStreamAudioTrack();
  audio_encoder_.Close();
  audio_encoder_ = pp::AudioEncoder();
  
  uint32_t offset = offset_audio;
  
  uint32_t frame_offset = 0;
  uint8_t* arrayFooter = (uint8_t*) malloc(4);
  frame_offset = ivf_writer_.WriteWavGetSize( arrayFooter, offset - 8 );  
  offset_audio = 4;
  file_thread_.message_loop().PostWork(callback_factory_.NewCallback(&VideoEncoderInstance::SaveAudio, (char *)arrayFooter, 4));  

  frame_offset = ivf_writer_.WriteWavGetSize( arrayFooter, offset - 40 ); 
  offset_audio = 40;
  file_thread_.message_loop().PostWork(callback_factory_.NewCallback(&VideoEncoderInstance::SaveAudio, (char *)arrayFooter, 4));  
  
}



// ===========================================================================
//	основная процедура получения сообщений
// --------------------------------------------------------------------------
void VideoEncoderInstance::HandleMessage(const pp::Var& var_message) {
	
	if (!var_message.is_dictionary()) {
		LogToConsole(PP_LOGLEVEL_ERROR, pp::Var("Invalid message!"));
		return;
	}

	pp::VarDictionary dict_message(var_message);
	std::string command = dict_message.Get("command").AsString();
  std::string temp;

	if (command == "start") {
		requested_size_ = pp::Size(	dict_message.Get("width").AsInt(),
									              dict_message.Get("height").AsInt());

    offset_video = 0;
    offset_audio = 0;
    offset_camera = 0;

    // ------ video              
 		pp::Var var_track_video = dict_message.Get("video");
		if (var_track_video.is_resource()) {
			is_video_ = true;
      temp = dict_message.Get("video_filename").AsString();
      if ( temp.empty() ) videoFileName = "/capture.webm";
      else videoFileName = temp;

      pp::Resource resource_track_video = var_track_video.AsResource();
      video_track_ = pp::MediaStreamVideoTrack(resource_track_video);

		} 
    else {
      LogToConsole(PP_LOGLEVEL_ERROR, pp::Var("Given video track is not a resource"));
    }
		
    // ------ audio
		pp::Var var_track_audio = dict_message.Get("audio");
		if (var_track_audio.is_resource()) {
			is_audio_ = true;
      temp = dict_message.Get("audio_filename").AsString();
      if ( temp.empty() ) audioFileName = "/capture.wav";
      else audioFileName = temp;

      pp::Resource resource_track_audio = var_track_audio.AsResource();
      audio_track_ = pp::MediaStreamAudioTrack(resource_track_audio);   

		}
    else {
      LogToConsole(PP_LOGLEVEL_ERROR, pp::Var("Given audio track is not a resource"));
    }
		
    // ------ camera
		pp::Var var_track_camera = dict_message.Get("camera");
		if (var_track_camera.is_resource()) {
			is_camera_ = true;
      temp = dict_message.Get("camera_filename").AsString();
      if ( temp.empty() ) cameraFileName = "/camera.webm";
      else cameraFileName = temp;
		}
    else {
      LogToConsole(PP_LOGLEVEL_ERROR, pp::Var("Given camera track is not a resource"));
    }

		video_encoder_ = pp::VideoEncoder();
		video_profile_ = PP_VIDEOPROFILE_VP8_ANY;  

    file_thread_.message_loop().PostWork( callback_factory_.NewCallback(&VideoEncoderInstance::OpenFileSystem) );
    
		ConfigureTrack();
	} 
	else if (command == "stop") {
		StopEncode();
		StopAudioTrack();
    file_thread_.message_loop().PostWork( callback_factory_.NewCallback(&VideoEncoderInstance::CloseFileSystem) );
		Log("stopped");
	} 
	else {
		LogToConsole(PP_LOGLEVEL_ERROR, pp::Var("Invalid command!"));
	}
}

// ===========================================================================
//  работа с файлами
// --------------------------------------------------------------------------
void VideoEncoderInstance::OpenFileSystem(int32_t /* result */) {
	int32_t rv = file_system_.Open(1024 * 1024 * 1024, pp::BlockUntilComplete());
	if (rv == PP_OK) {
		file_system_ready_ = true;

    if (is_video_)  OpenFile(&fileVideo, videoFileName);

    if (is_audio_)  OpenFile(&fileAudio, audioFileName);

    if (is_camera_) OpenFile(&fileCamera, cameraFileName);

	} 
	else {
		LogError(rv, "Failed to open file system");
	}

}
void VideoEncoderInstance::CloseFileSystem(int32_t /* result */) {

    if (is_video_)  CloseFile(&fileVideo);

    if (is_audio_)  CloseFile(&fileAudio);

    if (is_camera_) CloseFile(&fileCamera);

    Log("CLOSE FILES");
}
// --------------------------------------------------------------------------
// открывает файл
void VideoEncoderInstance::OpenFile(pp::FileIO * file, std::string filename) {
  
  if (!file_system_ready_) {
    LogError(PP_ERROR_FAILED, "File system is not open"); 
    return;
  }
  
  pp::FileRef ref(file_system_, filename.c_str());

  int32_t open_result = file->Open(ref, PP_FILEOPENFLAG_WRITE | PP_FILEOPENFLAG_CREATE | PP_FILEOPENFLAG_TRUNCATE, pp::BlockUntilComplete());
  if (open_result != PP_OK) {
    LogError(open_result, "File open for write failed" );
    return;
  }

  Log("Open File "+filename+" - success" );

} 
// --------------------------------------------------------------------------
// закрывает файл
void VideoEncoderInstance::CloseFile(pp::FileIO * file) {
  
  if (!file_system_ready_) {
    LogError(PP_ERROR_FAILED, "File system is not open"); 
    return;
  }
  
  // Все байты были написаны, очистить буфер записи для завершения
  int32_t flush_result = file->Flush(pp::BlockUntilComplete());
  if (flush_result != PP_OK) {
      LogError(flush_result, "Video File fail to flush");
      return;
  }

} 
// --------------------------------------------------------------------------
// сохраняются данные в файле
void VideoEncoderInstance::SaveFile(pp::FileIO * file, const char * file_contents, uint32_t size, int64_t * offset_file) {
  
  // Мы обрезаем файл до 0 байт. Так что нам нужно только писать, если array_buffer не пусто
  if (size>0) {
    int32_t bytes_written = 0;
    int64_t offs = 0;
    do {
      bytes_written = file->Write( *offset_file, file_contents + offs, size, pp::BlockUntilComplete());
      if (bytes_written > 0) {
        *offset_file += bytes_written;
        offs += bytes_written;
      } 
      else {
        LogError(bytes_written, "File write failed" );
        return;
      }
    } while (bytes_written < static_cast<int64_t>(size));
  }
  
}
void VideoEncoderInstance::SaveVideo(int32_t /* result */, const char * file_contents, uint32_t size) {

  if (is_video_)  SaveFile( &fileVideo, file_contents, size, &offset_video);
  
}
void VideoEncoderInstance::SaveAudio(int32_t /* result */, const char * file_contents, uint32_t size) {

  if (is_audio_)  SaveFile( &fileAudio, file_contents, size, &offset_audio);

}
void VideoEncoderInstance::SaveCamera(int32_t /* result */, const char * file_contents, uint32_t size) {

  if (is_camera_)  SaveFile( &fileCamera, file_contents, size, &offset_camera);

}
// --------------------------------------------------------------------------
// записывает данные в файл
void VideoEncoderInstance::WriteVideoData(const void* buffer, uint32_t size) {

  uint32_t data_offset = 0;

  uint32_t frame_offset = 0;
  if (encoded_frames_ == 1) {
    
    uint8_t* arrayHeader = (uint8_t*) malloc(ivf_writer_.GetFileHeaderSize());      
    frame_offset = ivf_writer_.WriteFileHeader( arrayHeader, ToUpperString("vp8"), frame_size_.width(), frame_size_.height());

    file_thread_.message_loop().PostWork(callback_factory_.NewCallback(&VideoEncoderInstance::SaveVideo, (char *)arrayHeader, frame_offset));                     
    
    //free (arrayHeader);
    
  } 
  
  uint64_t timestamp = frames_timestamps_.front();
  frames_timestamps_.pop_front();
  
  uint8_t* arrayFrame = (uint8_t*) malloc(ivf_writer_.GetFrameHeaderSize());      
  
  data_offset = ivf_writer_.WriteFrameHeader(arrayFrame, timestamp, size);
  
  file_thread_.message_loop().PostWork(callback_factory_.NewCallback(&VideoEncoderInstance::SaveVideo, (char *)arrayFrame, data_offset));                     
  
  //free (arrayFrame);
  
  file_thread_.message_loop().PostWork(callback_factory_.NewCallback(&VideoEncoderInstance::SaveVideo, (char *)buffer, size));
  
}
void VideoEncoderInstance::WriteAudioData(const void* buffer, uint32_t size) {

  file_thread_.message_loop().PostWork(callback_factory_.NewCallback(&VideoEncoderInstance::SaveAudio, (char *)buffer, size));

}


// ===========================================================================
// посылаются сообщения chrome
// --------------------------------------------------------------------------
void VideoEncoderInstance::PostDataMessage(const void* buffer, uint32_t size) {
	
	pp::VarDictionary dictionary;

	dictionary.Set(pp::Var("name"), pp::Var("data"));

	pp::VarArrayBuffer array_buffer;
	uint8_t* data_ptr;
	uint32_t data_offset = 0;

	uint32_t frame_offset = 0;
	if (encoded_frames_ == 1) {
		array_buffer = pp::VarArrayBuffer( size + ivf_writer_.GetFileHeaderSize() + ivf_writer_.GetFrameHeaderSize());
		data_ptr = static_cast<uint8_t*>(array_buffer.Map());
		
		frame_offset = ivf_writer_.WriteFileHeader( data_ptr, 
													ToUpperString("vp8"),
													frame_size_.width(), 
													frame_size_.height());
	} 
	else {
		array_buffer = pp::VarArrayBuffer(size + ivf_writer_.GetFrameHeaderSize());
		data_ptr = static_cast<uint8_t*>(array_buffer.Map());
	}
	
	uint64_t timestamp = frames_timestamps_.front();
	frames_timestamps_.pop_front();
	
	data_offset = frame_offset + ivf_writer_.WriteFrameHeader(data_ptr + frame_offset, timestamp, size);

	memcpy(data_ptr + data_offset, buffer, size);
	array_buffer.Unmap();
	dictionary.Set(pp::Var("data"), array_buffer);

	PostMessage(dictionary);
}
//  вывод сообщений
// --------------------------------------------------------------------------
void VideoEncoderInstance::Log(const std::string& message) {
  pp::VarDictionary dictionary;
  dictionary.Set(pp::Var("name"), pp::Var("log"));
  dictionary.Set(pp::Var("message"), pp::Var(message));

  PostMessage(dictionary);
}
// --------------------------------------------------------------------------
//  сообщения о ошибке
void VideoEncoderInstance::LogError(int32_t error, const std::string& message) {
  std::string msg("Error: ");
  msg.append(pp::Var(error).DebugString());
  msg.append(" : ");
  msg.append(message);

  Log(msg);
}



// ===========================================================================
pp::Instance* VideoEncoderModule::CreateInstance(PP_Instance instance) {
  return new VideoEncoderInstance(instance, this);
}

}  // anonymous namespace

namespace pp {
// Factory function for your specialization of the Module object.
Module* CreateModule() {
  return new VideoEncoderModule();
}
}  // namespace pp
